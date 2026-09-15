/**
 * An ephemeral backend for one pull request.
 *
 * Deliberately not a copy of Mr20PendantStack. The voice service — VPC, ALB,
 * Fargate, ECR, CodeBuild — and the CloudFront distributions are the slow and
 * expensive half of that stack, and take about twenty minutes to raise and as
 * long to tear down. None of it is needed to try an API change, so this stack
 * is the data plane and the two Lambdas that act on it, and nothing else. It
 * comes up in a couple of minutes.
 *
 * Everything here is disposable: every removal policy is DESTROY, the bucket
 * empties itself, and the whole stack is deleted when its pull request closes.
 * Nothing in it is shared with production except the API keys, which are read
 * from the same secrets and never written.
 */
import { Stack, StackProps, Duration, RemovalPolicy, CfnOutput, Tags, Size } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as path from 'node:path';
import { createDataPlane } from './data-plane';

const LWA_LAYER_ARN = 'arn:aws:lambda:ap-south-1:753240598075:layer:LambdaAdapterLayerArm64:25';

export interface PreviewStackProps extends StackProps {
  /** The pull request this environment belongs to. Names everything. */
  readonly pullRequest: string;
  readonly bedrockModelId: string;
  /**
   * Which set of integration credentials this environment runs on. Staging
   * takes every integration's test credentials, so a preview can neither read
   * a production user nor spend production quota. See ENVIRONMENTS in
   * bin/app.ts for what each side resolves to.
   */
  readonly staging: boolean;
  /** Clerk instance whose session tokens this environment accepts. */
  readonly clerkIssuer: string;
  /** Secrets Manager name of that instance's Clerk backend API key. */
  readonly clerkSecretName: string;
  /**
   * Secrets Manager name of the Razorpay key pair for this environment. Live
   * keys in production, test keys in staging: a preview taking a real payment
   * is not a mistake anyone should be able to make.
   */
  readonly razorpaySecretName: string;
  /**
   * The Automation plan's id in Razorpay for this environment — a test-mode
   * plan for a preview, so it never shares a subscription with production.
   * An id, not a credential, so no secret grant is needed.
   */
  readonly razorpayPlanAutomation: string;
  /**
   * Read from the production stack's outputs by the workflow and passed in.
   * These secrets are named by CloudFormation, not by us — DeepgramApiKey is
   * really DeepgramApiKeyBBD97097-YdJwp7yjPX9k — so a preview cannot look them
   * up by the name in the source.
   */
  readonly deepgramSecretArn: string;
  readonly sarvamSecretArn: string;
  readonly claudeOAuthSecretArn: string;
}

export class PreviewStack extends Stack {
  constructor(scope: Construct, id: string, props: PreviewStackProps) {
    super(scope, id, props);
    Tags.of(this).add('project', 'mr20-pendant');
    // What a sweeper would look for if one of these is ever orphaned.
    Tags.of(this).add('ephemeral', 'true');
    Tags.of(this).add('pull-request', props.pullRequest);

    // The same definition production builds from, so a preview can never test
    // a data model production does not have: a table added there appears here
    // on the next deploy. Only durability differs. See lib/data-plane.ts.
    const { table, audioBucket, ingestQueue, extractQueue, extractDlq, applyQueue } =
      createDataPlane(this, { ephemeral: true });

    // Read-only, and by name: a preview must never be able to rewrite the key
    // production runs on.
    const deepgramSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this, 'DeepgramSecret', props.deepgramSecretArn);
    const sarvamSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this, 'SarvamSecret', props.sarvamSecretArn);
    const claudeOAuthSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this, 'ClaudeOAuthSecret', props.claudeOAuthSecretArn);
    // These two we do name, because we named them.
    const gitloomSecret = secretsmanager.Secret.fromSecretNameV2(this, 'GitLoomSecret', 'mr20/gitloom');
    const clerkSecret = secretsmanager.Secret.fromSecretNameV2(this, 'ClerkSecret', props.clerkSecretName);
    const razorpaySecret = secretsmanager.Secret.fromSecretNameV2(this, 'RazorpaySecret', props.razorpaySecretName);
    // Same identity a preview and production both send confirmation emails
    // through — SES has no sandbox/live split the way Razorpay's keys do,
    // so there is nothing a second secret would isolate.
    const sesSecret = secretsmanager.Secret.fromSecretNameV2(this, 'SesSecret', 'mr20/ses');

    const goFn = (
      name: string,
      cmd: string,
      options: {
        env?: Record<string, string>;
        timeout?: Duration;
        memory?: number;
        ephemeralStorage?: Size;
        layers?: lambda.ILayerVersion[];
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
        environment: { TABLE_NAME: table.tableName, ...options.env },
        layers: options.layers,
        logGroup: new logs.LogGroup(this, `${name}Logs`, {
          // A preview's logs are worth a day, not a month.
          retention: logs.RetentionDays.ONE_DAY,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
      });

    const apiFn = goFn('ApiFn', 'api', {
      env: {
        INGEST_QUEUE_URL: ingestQueue.queueUrl,
        // Staging's Clerk is the test instance, so a token minted against
        // production is refused here and vice versa — the isolation is not a
        // convention anyone has to remember.
        STAGING: String(props.staging),
        CLERK_ISSUER: props.clerkIssuer,
        CLERK_SECRET_ARN: clerkSecret.secretArn,
        RAZORPAY_SECRET_ARN: razorpaySecret.secretArn,
        RAZORPAY_PLAN_AUTOMATION: props.razorpayPlanAutomation,
        GITLOOM_SECRET_ARN: gitloomSecret.secretArn,
        SES_SECRET_ARN: sesSecret.secretArn,
        CHAT_MODEL_ID: props.bedrockModelId,
        AUDIO_BUCKET: audioBucket.bucketName,
        AWS_LAMBDA_EXEC_WRAPPER: '/opt/bootstrap',
        PORT: '8080',
        AWS_LWA_INVOKE_MODE: 'response_stream',
      },
      timeout: Duration.minutes(5),
      memory: 1024,
      layers: [lambda.LayerVersion.fromLayerVersionArn(this, 'LwaLayer', LWA_LAYER_ARN)],
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
        resources: ['*'],
      }),
    );

    const processor = goFn('ProcessorFn', 'processor', {
      env: {
        DEEPGRAM_SECRET_ARN: deepgramSecret.secretArn,
        SARVAM_SECRET_ARN: sarvamSecret.secretArn,
        BEDROCK_MODEL_ID: props.bedrockModelId,
        GITLOOM_SECRET_ARN: gitloomSecret.secretArn,
        AUDIO_BUCKET: audioBucket.bucketName,
        FFMPEG_PATH: '/var/task/bin/ffmpeg',
        DEEP_FILTER_PATH: '/var/task/bin/deep-filter',
        EXTRACT_QUEUE_URL: extractQueue.queueUrl,
      },
      timeout: Duration.minutes(15),
      memory: 3008,
      ephemeralStorage: Size.gibibytes(2),
    });

    table.grantReadWriteData(processor);
    audioBucket.grantReadWrite(processor);
    audioBucket.grantDelete(processor);
    deepgramSecret.grantRead(processor);
    sarvamSecret.grantRead(processor);
    gitloomSecret.grantRead(processor);
    processor.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
      }),
    );
    // The bucket already notifies the queue — createDataPlane wires that.
    processor.addEventSource(new lambdaEventSources.SqsEventSource(ingestQueue, { batchSize: 1 }));
    extractQueue.grantSendMessages(processor);

    // No reservedConcurrentExecutions on either function — this stack has
    // never set one for anything, on the reasoning a preview never carries
    // production's volume.
    const extractFn = new lambda.DockerImageFunction(this, 'ExtractFn', {
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, '..', 'extract'), {
        platform: ecrAssets.Platform.LINUX_ARM64,
      }),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 3008,
      timeout: Duration.seconds(900),
      ephemeralStorageSize: Size.mebibytes(4096),
      environment: {
        AUDIO_BUCKET: audioBucket.bucketName,
        APPLY_QUEUE_URL: applyQueue.queueUrl,
        CLAUDE_OAUTH_SECRET_ARN: claudeOAuthSecret.secretArn,
        GITLOOM_SECRET_ARN: gitloomSecret.secretArn,
      },
      logGroup: new logs.LogGroup(this, 'ExtractFnLogs', {
        retention: logs.RetentionDays.ONE_DAY,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
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
        // goFn's own env merge (above) only injects TABLE_NAME here, unlike
        // production's commonEnv, which also carries AUDIO_BUCKET — so this
        // stays explicit or ApplyFn calls S3 with an empty bucket name.
        AUDIO_BUCKET: audioBucket.bucketName,
        GITLOOM_SECRET_ARN: gitloomSecret.secretArn,
        BEDROCK_MODEL_ID: props.bedrockModelId,
      },
      timeout: Duration.minutes(3),
      memory: 512,
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
    applyFn.addEventSource(
      new lambdaEventSources.SqsEventSource(extractDlq, { batchSize: 1, reportBatchItemFailures: true }),
    );

    // No CORS block here, deliberately. The Fiber app already sends
    // Access-Control-Allow-Origin (internal/api/app.go), and a Function URL
    // configured with CORS sends its own — the browser then sees the header
    // twice ("*, http://localhost:5173") and refuses the response, which is
    // exactly the wildcard-CORS case a preview exists to serve. One writer,
    // and it is the app, so production and a preview behave identically.
    const apiUrl = apiFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    });

    new CfnOutput(this, 'ApiUrl', { value: apiUrl.url });
    new CfnOutput(this, 'PullRequest', { value: props.pullRequest });
  }
}
