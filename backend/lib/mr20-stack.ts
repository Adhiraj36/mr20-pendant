/**
 * MR20 pendant backend.
 *
 * Everything is on-demand or per-invocation: DynamoDB on-demand, Lambda, SQS,
 * S3. Idle cost is the S3 storage and nothing else.
 *
 * The application code is Go (backend/go): event-driven Lambdas for the
 * ingest pipeline, and one Fiber app — behind the AWS Lambda Web Adapter on a
 * streaming Function URL — for the whole HTTP API, chat SSE included. Run
 * backend/go/build.sh before deploying; the assets here point at its dist/
 * output.
 *
 * Clerk owns authentication outright. The API verifies Clerk session tokens
 * against that instance's JWKS and consults nothing else; there is no user
 * pool, no password, and no sign-in code to mail.
 */
import {
  Stack, StackProps, Duration, RemovalPolicy, CfnOutput, Tags, Size,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as s3assets from 'aws-cdk-lib/aws-s3-assets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as path from 'node:path';
import { createDataPlane } from './data-plane';

export interface Mr20StackProps extends StackProps {
  bedrockModelId: string;
  /** The Clerk instance whose session tokens this API accepts. */
  clerkIssuer: string;
  /**
   * Secrets Manager name of that instance's Clerk backend API key. Verifying a
   * session token needs only the issuer's public JWKS; this is for calling
   * Clerk back — reading a user, revoking a session — and is wired in so the
   * key has one home rather than being pasted somewhere when first needed.
   */
  clerkSecretName: string;
  /**
   * Secrets Manager name of the Razorpay key pair for this environment. Live
   * keys in production, test keys in staging: a preview taking a real payment
   * is not a mistake anyone should be able to make.
   */
  razorpaySecretName: string;
  /**
   * The Automation plan's id in Razorpay — created by hand, one per
   * environment, priced at ₹1,500/month. A subscription is created against
   * it per customer at checkout, so this is an id, not a credential, and
   * needs no secret grant.
   */
  razorpayPlanAutomation: string;
  /**
   * Custom domain for the API, e.g. api.lyzn.ai. Served by CloudFront in front
   * of the Function URL, which stays reachable on its own address: builds
   * already in the App Store have that address compiled in.
   *
   * CloudFront rather than API Gateway because the chat endpoint streams, and
   * API Gateway buffers Lambda responses instead of passing them through.
   *
   * Both are optional together: leave them unset and no distribution is made,
   * so the stack still deploys before the certificate finishes validating.
   */
  /**
   * Whether the live voice service (Fargate + ALB) is part of the stack.
   * Off by default: see the voice section below for why, and README's
   * "Context overrides" for switching it back on.
   */
  voice?: boolean;
  apiDomainName?: string;
  /** Certificate for apiDomainName. Must be in us-east-1, as CloudFront requires. */
  apiCertificateArn?: string;
}

/**
 * Hard-coded processor fan-out: how many recordings transcribe at once.
 * Deliberately a constant in code rather than context, per the runbook.
 */
const PROCESSOR_CONCURRENCY = 4;

/**
 * AWS Lambda Web Adapter, public layer. Fronts the Fiber binary so it serves
 * plain HTTP; RESPONSE_STREAM on the Function URL is what streams the chat.
 */
const LWA_LAYER_ARN = 'arn:aws:lambda:ap-south-1:753240598075:layer:LambdaAdapterLayerArm64:25';

export class Mr20Stack extends Stack {
  constructor(scope: Construct, id: string, props: Mr20StackProps) {
    super(scope, id, props);
    Tags.of(this).add('project', 'mr20-pendant');

    // -- storage ----------------------------------------------------------

    // Shared with a pull request's preview so the two data models cannot
    // drift. See lib/data-plane.ts.
    const { table, audioBucket, ingestQueue, dlq, extractQueue, extractDlq, applyQueue, applyDlq } =
      createDataPlane(this, { ephemeral: false });

    // -- secrets ----------------------------------------------------------

    const deepgramSecret = new secretsmanager.Secret(this, 'DeepgramApiKey', {
      description: 'Deepgram API key used for transcription and diarization',
      generateSecretString: {
        // Placeholder only. Overwrite after deploy with the real key:
        //   aws secretsmanager put-secret-value --secret-id <arn> --secret-string '<key>'
        secretStringTemplate: JSON.stringify({ apiKey: 'REPLACE_ME' }),
        generateStringKey: 'unused',
      },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const sarvamSecret = new secretsmanager.Secret(this, 'SarvamApiKey', {
      description: 'Sarvam API key: the second speech-to-text engine the transcript merge referees',
      generateSecretString: {
        // Placeholder only. Overwrite after deploy with the real key:
        //   aws secretsmanager put-secret-value --secret-id <arn> --secret-string '<key>'
        secretStringTemplate: JSON.stringify({ apiKey: 'REPLACE_ME' }),
        generateStringKey: 'unused',
      },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const claudeOAuthSecret = new secretsmanager.Secret(this, 'ClaudeCodeOAuthToken', {
      description: 'Claude subscription OAuth token ExtractFn runs Claude Code with (claude setup-token)',
      generateSecretString: {
        // Placeholder only. Overwrite after deploy:
        //   aws secretsmanager put-secret-value --secret-id <arn> --secret-string '{"token":"<real token>"}'
        secretStringTemplate: JSON.stringify({ token: 'REPLACE_ME' }),
        generateStringKey: 'unused',
      },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Created outside the stack (their value is the credential); referenced by
    // name so a stack teardown can never take a key with it.
    const gitloomSecret = secretsmanager.Secret.fromSecretNameV2(this, 'GitLoomSecret', 'mr20/gitloom');
    const clerkSecret = secretsmanager.Secret.fromSecretNameV2(this, 'ClerkSecret', props.clerkSecretName);
    const razorpaySecret = secretsmanager.Secret.fromSecretNameV2(this, 'RazorpaySecret', props.razorpaySecretName);
    // Holds an access key pair for lyzn.ai's SES identity in a *different*
    // AWS account (022499029734) than this stack's own — internal/mail
    // builds its client from these explicitly rather than this Lambda's
    // role, which has no standing there. See internal/config.SES.
    const sesSecret = secretsmanager.Secret.fromSecretNameV2(this, 'SesSecret', 'mr20/ses');

    // -- lambda plumbing --------------------------------------------------

    const commonEnv = {
      TABLE_NAME: table.tableName,
      AUDIO_BUCKET: audioBucket.bucketName,
    };

    /** A Go Lambda from backend/go/build.sh output. */
    const goFn = (
      name: string,
      cmd: string,
      options: {
        env?: Record<string, string>;
        timeout?: Duration;
        memory?: number;
        ephemeralStorage?: Size;
        description?: string;
        layers?: lambda.ILayerVersion[];
        reservedConcurrency?: number;
      } = {},
    ) =>
      new lambda.Function(this, name, {
        runtime: lambda.Runtime.PROVIDED_AL2023,
        architecture: lambda.Architecture.ARM_64,
        handler: 'bootstrap',
        code: lambda.Code.fromAsset(path.join(__dirname, '..', 'go', 'dist', cmd)),
        timeout: options.timeout ?? Duration.seconds(15),
        memorySize: options.memory ?? 256,
        ephemeralStorageSize: options.ephemeralStorage,
        environment: { ...commonEnv, ...options.env },
        layers: options.layers,
        reservedConcurrentExecutions: options.reservedConcurrency,
        logGroup: new logs.LogGroup(this, `${name}Logs`, {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
        description: options.description,
      });

    // -- HTTP API: one Fiber app ------------------------------------------

    const apiFn = goFn('ApiFn', 'api', {
      env: {
        INGEST_QUEUE_URL: ingestQueue.queueUrl,
        // Clerk issues the session tokens this API trusts. Set explicitly
        // rather than left to the code's default, so which instance is
        // trusted is visible in the stack and changeable without a release.
        CLERK_ISSUER: props.clerkIssuer,
        CLERK_SECRET_ARN: clerkSecret.secretArn,
        RAZORPAY_SECRET_ARN: razorpaySecret.secretArn,
        RAZORPAY_PLAN_AUTOMATION: props.razorpayPlanAutomation,
        GITLOOM_SECRET_ARN: gitloomSecret.secretArn,
        SES_SECRET_ARN: sesSecret.secretArn,
        CHAT_MODEL_ID: props.bedrockModelId,
        // Web Adapter wiring: run the wrapper, talk to Fiber on this port,
        // stream responses through instead of buffering them.
        AWS_LAMBDA_EXEC_WRAPPER: '/opt/bootstrap',
        PORT: '8080',
        AWS_LWA_INVOKE_MODE: 'response_stream',
      },
      // A chat turn holds the stream open for as long as the model talks.
      timeout: Duration.minutes(5),
      memory: 1024,
      layers: [
        lambda.LayerVersion.fromLayerVersionArn(this, 'LwaLayer', LWA_LAYER_ARN),
      ],
      description: 'The HTTP API: devices, recordings, categories and chat (Fiber)',
    });

    table.grantReadWriteData(apiFn);
    audioBucket.grantReadWrite(apiFn);
    audioBucket.grantDelete(apiFn);
    ingestQueue.grantSendMessages(apiFn);
    gitloomSecret.grantRead(apiFn);
    clerkSecret.grantRead(apiFn);
    razorpaySecret.grantRead(apiFn);
    sesSecret.grantRead(apiFn);
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        // Inference profiles route across regions, so the model resources they
        // reach cannot be pinned to this one.
        resources: ['*'],
      }),
    );

    const apiUrl = apiFn.addFunctionUrl({
      // Clerk session tokens are verified inside the app (Fiber middleware);
      // the URL itself is open the same way an API Gateway endpoint is.
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    });

    // A custom domain for the API, when one is configured. CloudFront passes
    // streamed responses through, so /chat keeps streaming; nothing is cached
    // except the public /config document, and the viewer's request is
    // forwarded whole, minus Host — a Function URL origin rejects a Host
    // header that is not its own.
    let apiDistribution: cloudfront.Distribution | undefined;
    if (props.apiDomainName && props.apiCertificateArn) {
      const apiOrigin = new origins.FunctionUrlOrigin(apiUrl);
      apiDistribution = new cloudfront.Distribution(this, 'ApiDistribution', {
        defaultBehavior: {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        // The one route that is cached, and the only one that can be:
        // GET /config is public, identical for everybody, and read by every
        // screen the app opens. Sixty seconds is what the handler's own
        // Cache-Control says, so an edit through PUT /admin/config is live
        // everywhere within a minute.
        //
        // The cache key is the path and nothing else — no query string, no
        // header, no cookie — so a signed-in reader and a stranger share one
        // object. The viewer's request still reaches the origin whole (minus
        // Host, which a Function URL refuses) on a miss: what is forwarded
        // and what is keyed on are different questions.
        additionalBehaviors: {
          '/config*': {
            origin: apiOrigin,
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
            cachePolicy: new cloudfront.CachePolicy(this, 'ApiConfigCachePolicy', {
              cachePolicyName: `${Stack.of(this).stackName}-config-60s`,
              comment: 'GET /config — one public document, sixty seconds',
              defaultTtl: Duration.seconds(60),
              minTtl: Duration.seconds(0),
              maxTtl: Duration.seconds(60),
              queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
              headerBehavior: cloudfront.CacheHeaderBehavior.none(),
              cookieBehavior: cloudfront.CacheCookieBehavior.none(),
              enableAcceptEncodingGzip: true,
              enableAcceptEncodingBrotli: true,
            }),
            originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          },
        },
        domainNames: [props.apiDomainName],
        certificate: acm.Certificate.fromCertificateArn(
          this,
          'ApiCertificate',
          props.apiCertificateArn,
        ),
        priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      });
    }

    // -- processor --------------------------------------------------------

    const processor = goFn('ProcessorFn', 'processor', {
      env: {
        DEEPGRAM_SECRET_ARN: deepgramSecret.secretArn,
        SARVAM_SECRET_ARN: sarvamSecret.secretArn,
        BEDROCK_MODEL_ID: props.bedrockModelId,
        GITLOOM_SECRET_ARN: gitloomSecret.secretArn,
        // Audio-enhancement binaries bundled by build.sh into the asset zip.
        FFMPEG_PATH: '/var/task/bin/ffmpeg',
        DEEP_FILTER_PATH: '/var/task/bin/deep-filter',
        EXTRACT_QUEUE_URL: extractQueue.queueUrl,
      },
      // Denoising runs ~5x real time on one core, and Bedrock on a long
      // transcript is not fast either; the queue's visibility timeout is set
      // above this.
      timeout: Duration.minutes(15),
      // Memory is the CPU dial on Lambda; the denoiser is compute-bound.
      memory: 3008,
      // Enhancement stages a recording as 48 kHz WAV twice over in /tmp —
      // an hour of audio is ~350 MB per copy, past the 512 MB default.
      ephemeralStorage: Size.gibibytes(2),
      reservedConcurrency: PROCESSOR_CONCURRENCY,
      description: 'Denoises, transcribes, diarizes, enriches and remembers an uploaded recording',
    });

    table.grantReadWriteData(processor);
    audioBucket.grantReadWrite(processor);
    audioBucket.grantDelete(processor); // the archive move deletes the original
    deepgramSecret.grantRead(processor);
    sarvamSecret.grantRead(processor);
    gitloomSecret.grantRead(processor);
    processor.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
      }),
    );

    processor.addEventSource(
      new lambdaEventSources.SqsEventSource(ingestQueue, {
        batchSize: 1, // one recording per invocation keeps retries precise
        reportBatchItemFailures: true,
      }),
    );
    extractQueue.grantSendMessages(processor);

    // -- extraction --------------------------------------------------------
    //
    // The first container-image Lambda in this backend: claude-agent-sdk's
    // bundled CLI is a ~207 MB platform-specific ELF, which rules out zip
    // packaging outright. Platform.LINUX_ARM64 here and Architecture.ARM_64
    // below must never drift apart — a mismatch fails at runtime with
    // nothing more specific than "failed to start Claude Code".
    const EXTRACT_CONCURRENCY = 4;

    const extractFn = new lambda.DockerImageFunction(this, 'ExtractFn', {
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, '..', 'extract'), {
        platform: ecrAssets.Platform.LINUX_ARM64,
      }),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 3008,
      timeout: Duration.seconds(900),
      ephemeralStorageSize: Size.mebibytes(4096),
      reservedConcurrentExecutions: EXTRACT_CONCURRENCY,
      environment: {
        AUDIO_BUCKET: audioBucket.bucketName,
        APPLY_QUEUE_URL: applyQueue.queueUrl,
        CLAUDE_OAUTH_SECRET_ARN: claudeOAuthSecret.secretArn,
        GITLOOM_SECRET_ARN: gitloomSecret.secretArn,
      },
      logGroup: new logs.LogGroup(this, 'ExtractFnLogs', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      description: 'Runs Claude Code over a transcript: corrections, tasks, memories and a summary, as four files',
    });
    audioBucket.grantReadWrite(extractFn);
    applyQueue.grantSendMessages(extractFn);
    claudeOAuthSecret.grantRead(extractFn);
    gitloomSecret.grantRead(extractFn);
    extractFn.addEventSource(
      new lambdaEventSources.SqsEventSource(extractQueue, { batchSize: 1, reportBatchItemFailures: true }),
    );

    const applyFn = goFn('ApplyFn', 'apply', {
      env: {
        GITLOOM_SECRET_ARN: gitloomSecret.secretArn,
        BEDROCK_MODEL_ID: props.bedrockModelId,
      },
      timeout: Duration.minutes(3),
      memory: 512,
      // ApplyFn consumes both applyQueue and extractDlq, so the same
      // recording can arrive on both at once. That used to race its facts
      // guard (finishApply, cmd/apply): a read-then-write on
      // rec.FactsMemoryStatus, with no ConditionExpression, so two
      // concurrent invocations could both see it empty and both send the
      // same facts to GitLoom, which has no delete or supersede to undo the
      // duplicate. finishApply now guards the send itself with
      // ddb.SetFactsMemoryStatusIfUnset — a per-recording conditional
      // claim, not a Lambda-wide lock — so the race is closed without
      // forcing every recording's apply step to run one at a time
      // account-wide.
      //
      // A cap still belongs here, unlike leaving this unreserved: ApplyFn
      // is short and I/O-bound (a handful of DynamoDB writes, one S3
      // read/put, and — only on the Bedrock fallback path or a GitLoom
      // send — one outbound call), nothing like ProcessorFn's denoising or
      // ExtractFn's own Claude Code container, so it does not need as tight
      // a fan-out limit as those. But an unreserved function scales with
      // whatever of the account's shared pool is free at the moment —
      // exactly what a DLQ redrive or an extraction backlog draining all at
      // once would hand it — and DynamoDB and GitLoom are still shared
      // resources worth a deliberate ceiling rather than an ambient one.
      // 10 is well above EXTRACT_CONCURRENCY (4) — its own messages and
      // extractDlq's fallback are both gated by that upstream limit under
      // normal operation — so a steady pipeline is never bottlenecked
      // here, while a sudden backlog still fans out no wider than this.
      reservedConcurrency: 10,
      description: 'The only thing that writes state: applies extraction output, or the Bedrock fallback',
    });
    table.grantReadWriteData(applyFn);
    audioBucket.grantReadWrite(applyFn);
    gitloomSecret.grantRead(applyFn);
    applyFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
      }),
    );
    applyFn.addEventSource(
      new lambdaEventSources.SqsEventSource(applyQueue, { batchSize: 1, reportBatchItemFailures: true }),
    );
    // extractQueue's own DLQ, reached once ExtractFn has exhausted every
    // retry — ApplyFn treats a message from here identically to one from
    // applyQueue (internal/apply.ExtractionPrefix's comment explains why
    // both carry the same shape).
    applyFn.addEventSource(
      new lambdaEventSources.SqsEventSource(extractDlq, { batchSize: 1, reportBatchItemFailures: true }),
    );

    const reaper = goFn('DlqReaperFn', 'dlqreaper', {
      env: { APPLY_DLQ_ARN: applyDlq.queueArn },
      timeout: Duration.minutes(2),
      description: 'Marks recordings failed once their retries are exhausted, in either pipeline',
    });
    table.grantReadWriteData(reaper);
    reaper.addEventSource(new lambdaEventSources.SqsEventSource(dlq, { batchSize: 5 }));
    reaper.addEventSource(new lambdaEventSources.SqsEventSource(applyDlq, { batchSize: 5 }));

    // -- voice service ----------------------------------------------------
    //
    // A live voice session is a stateful stream — microphone in, transcript
    // and speech out over one WebSocket — which is exactly what Lambda cannot
    // hold. A single small Fargate task runs cmd/voiced behind an ALB; its
    // image is built by CodeBuild (no container runtime on the dev machine)
    // from the backend/go source asset. After a deploy that changes voiced:
    //   aws codebuild start-build --project-name <VoiceImageBuild output>
    //   aws ecs update-service --cluster <cluster> --service <service> --force-new-deployment
    //
    // Off unless props.voice says otherwise. Live voice chat is parked: the
    // ALB was removed from the console on 2026-09-15 to stop paying for it,
    // and a stack that still described it could not update at all — every
    // deploy rolled back resolving the VoiceUrl output against a load
    // balancer that no longer existed. With the flag off the section is not
    // synthesised, so the remnants (VPC, cluster, the scaled-to-zero
    // service) are removed and the outputs go with them; sync-config.sh
    // already treats VoiceUrl as optional and the app reads an empty
    // voiceUrl as "not deployed". VoiceRepo is RETAIN, so the built images
    // survive for the day this is switched back on with -c voice=true.
    if (props.voice) {
      const voiceRepo = new ecr.Repository(this, 'VoiceRepo', {
        removalPolicy: RemovalPolicy.RETAIN,
        lifecycleRules: [{ maxImageCount: 5 }],
      });

      const voiceSource = new s3assets.Asset(this, 'VoiceSource', {
        path: path.join(__dirname, '..', 'go'),
        exclude: ['dist', 'lambda-assets'],
      });

      const voiceImageBuild = new codebuild.Project(this, 'VoiceImageBuild', {
        description: 'Builds the voiced container image and pushes it to ECR',
        source: codebuild.Source.s3({
          bucket: voiceSource.bucket,
          path: voiceSource.s3ObjectKey,
        }),
        environment: {
          buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0,
          computeType: codebuild.ComputeType.SMALL,
          privileged: true,
        },
        environmentVariables: {
          REPO_URI: { value: voiceRepo.repositoryUri },
        },
        buildSpec: codebuild.BuildSpec.fromObject({
          version: '0.2',
          phases: {
            pre_build: {
              commands: [
                'aws ecr get-login-password | docker login --username AWS --password-stdin ${REPO_URI%%/*}',
              ],
            },
            build: {
              commands: [
                'docker build -f Dockerfile.voiced -t $REPO_URI:latest .',
                'docker push $REPO_URI:latest',
              ],
            },
          },
        }),
      });
      voiceRepo.grantPullPush(voiceImageBuild);

      // Public subnets only: no NAT to pay for, the task gets a public IP for
      // its outbound calls, and the ALB fronts inbound.
      const voiceVpc = new ec2.Vpc(this, 'VoiceVpc', {
        maxAzs: 2,
        natGateways: 0,
        subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC }],
      });
      const voiceCluster = new ecs.Cluster(this, 'VoiceCluster', { vpc: voiceVpc });

      const voiceTask = new ecs.FargateTaskDefinition(this, 'VoiceTask', {
        cpu: 256,
        memoryLimitMiB: 512,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.ARM64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      });
      voiceTask.addContainer('voiced', {
        image: ecs.ContainerImage.fromEcrRepository(voiceRepo, 'latest'),
        logging: ecs.LogDrivers.awsLogs({
          streamPrefix: 'voiced',
          logGroup: new logs.LogGroup(this, 'VoicedLogs', {
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY,
          }),
        }),
        environment: {
          PORT: '8080',
          AWS_REGION: this.region,
          CLERK_ISSUER: props.clerkIssuer,
          DEEPGRAM_SECRET_ARN: deepgramSecret.secretArn,
          SARVAM_SECRET_ARN: sarvamSecret.secretArn,
          GITLOOM_SECRET_ARN: gitloomSecret.secretArn,
          BEDROCK_MODEL_ID: props.bedrockModelId,
        },
        portMappings: [{ containerPort: 8080 }],
      });
      deepgramSecret.grantRead(voiceTask.taskRole);
      sarvamSecret.grantRead(voiceTask.taskRole);
      gitloomSecret.grantRead(voiceTask.taskRole);
      voiceTask.taskRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
          resources: ['*'],
        }),
      );

      // desiredCount starts at 0: the first deploy has no image in ECR yet, and
      // CloudFormation would wait forever on a service that cannot start. Run
      // the image build, then scale to 1.
      const voiceService = new ecs.FargateService(this, 'VoiceService', {
        cluster: voiceCluster,
        taskDefinition: voiceTask,
        desiredCount: 0,
        assignPublicIp: true,
        minHealthyPercent: 0,
        circuitBreaker: { rollback: false },
      });

      const voiceAlb = new elbv2.ApplicationLoadBalancer(this, 'VoiceAlb', {
        vpc: voiceVpc,
        internetFacing: true,
        // A voice session sits quietly between turns; do not cut it off.
        idleTimeout: Duration.minutes(10),
      });
      const voiceListener = voiceAlb.addListener('Http', { port: 80, open: true });
      voiceListener.addTargets('Voiced', {
        port: 8080,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targets: [voiceService],
        healthCheck: { path: '/healthz', interval: Duration.seconds(30) },
        deregistrationDelay: Duration.seconds(30),
      });

      new CfnOutput(this, 'VoiceUrl', { value: `ws://${voiceAlb.loadBalancerDnsName}/v1/voice` });
      new CfnOutput(this, 'VoiceImageBuildProject', { value: voiceImageBuild.projectName });
      new CfnOutput(this, 'VoiceClusterName', { value: voiceCluster.clusterName });
      new CfnOutput(this, 'VoiceServiceName', { value: voiceService.serviceName });
    }

    // -- outputs ----------------------------------------------------------

    new CfnOutput(this, 'ApiUrl', { value: apiUrl.url });
    if (apiDistribution && props.apiDomainName) {
      new CfnOutput(this, 'ApiCustomDomainUrl', { value: `https://${props.apiDomainName}` });
      // The value to point api.lyzn.ai at, in Cloudflare.
      new CfnOutput(this, 'ApiDistributionDomain', {
        value: apiDistribution.distributionDomainName,
      });
    }
    new CfnOutput(this, 'AudioBucketName', { value: audioBucket.bucketName });
    new CfnOutput(this, 'TableName', { value: table.tableName });
    new CfnOutput(this, 'DeepgramSecretArn', { value: deepgramSecret.secretArn });
    new CfnOutput(this, 'SarvamSecretArn', { value: sarvamSecret.secretArn });
    new CfnOutput(this, 'ClaudeOAuthSecretArn', { value: claudeOAuthSecret.secretArn });
    new CfnOutput(this, 'Region', { value: this.region });
  }
}
