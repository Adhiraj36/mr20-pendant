/**
 * The data plane: the table, the audio bucket and the ingest queue.
 *
 * Defined once and built by both the production stack and a pull request's
 * preview, so the two cannot drift. A new table, another index, a changed sort
 * key — anything added here reaches previews on their next deploy without
 * anyone remembering to copy it across. That is the whole point of the file:
 * a preview that tests a data model production does not have is worse than no
 * preview at all.
 *
 * It is a function rather than a Construct deliberately. A Construct would nest
 * these resources and change their logical ids, and CloudFormation reads a
 * changed logical id as a different resource — it would replace the production
 * table. Called with the stack as its scope, the ids stay exactly what they
 * have always been.
 *
 * What differs between the two environments is durability, never shape:
 * production retains and recovers, a preview is disposable.
 */
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';

export interface DataPlaneOptions {
  /**
   * A preview's data plane, which is thrown away with its pull request:
   * everything deletes, the bucket empties itself, and nothing is archived or
   * recovered because nothing in it is worth recovering.
   */
  readonly ephemeral: boolean;
}

export interface DataPlane {
  readonly table: dynamodb.Table;
  readonly audioBucket: s3.Bucket;
  readonly ingestQueue: sqs.Queue;
  readonly dlq: sqs.Queue;
  readonly extractQueue: sqs.Queue;
  readonly extractDlq: sqs.Queue;
  readonly applyQueue: sqs.Queue;
  readonly applyDlq: sqs.Queue;
}

export function createDataPlane(scope: Construct, options: DataPlaneOptions): DataPlane {
  const { ephemeral } = options;

  const table = new dynamodb.Table(scope, 'Table', {
    partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    // Kept, though nothing writes a ttl now that the sign-in codes it swept
    // are gone: it expires only rows that carry the attribute, and removing
    // it is a table modification with no benefit.
    timeToLiveAttribute: 'ttl',
    pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: !ephemeral },
    // The transcripts are the product. Never let a stack teardown take them.
    removalPolicy: ephemeral ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
  });

  // Lets the processor find a row from the recording id in the S3 key alone.
  table.addGlobalSecondaryIndex({
    indexName: 'GSI1',
    partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    projectionType: dynamodb.ProjectionType.ALL,
  });

  const audioBucket = new s3.Bucket(scope, 'AudioBucket', {
    encryption: s3.BucketEncryption.S3_MANAGED,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    enforceSSL: true,
    removalPolicy: ephemeral ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
    autoDeleteObjects: ephemeral,
    // Tiering matters over months; a preview does not live that long, and the
    // rules would only add noise to a stack that is deleted within days.
    lifecycleRules: ephemeral
      ? [{ id: 'abort-stalled-uploads', abortIncompleteMultipartUploadAfter: Duration.days(3) }]
      : [
          {
            // Recordings are read heavily for a few weeks then almost never.
            id: 'archive-old-audio',
            prefix: 'audio/',
            transitions: [
              { storageClass: s3.StorageClass.INFREQUENT_ACCESS, transitionAfter: Duration.days(60) },
              { storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL, transitionAfter: Duration.days(180) },
            ],
          },
          {
            // No-speech recordings: the processor moves them here, and after a
            // month of nobody disputing "no speech" the audio expires.
            id: 'expire-archived-audio',
            prefix: 'archived/',
            expiration: Duration.days(30),
          },
          { id: 'abort-stalled-uploads', abortIncompleteMultipartUploadAfter: Duration.days(3) },
        ],
    cors: [
      {
        // The app PUTs audio straight to S3 with a presigned URL.
        allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
        allowedOrigins: ['*'],
        allowedHeaders: ['*'],
        exposedHeaders: ['ETag'],
        maxAge: 3000,
      },
    ],
  });

  const dlq = new sqs.Queue(scope, 'IngestDlq', {
    retentionPeriod: ephemeral ? Duration.days(4) : Duration.days(14),
    // Must exceed the reaper's own timeout or a slow drain redelivers.
    visibilityTimeout: Duration.minutes(3),
    enforceSSL: true,
  });

  const ingestQueue = new sqs.Queue(scope, 'IngestQueue', {
    // Long enough for Deepgram plus Bedrock on a multi-hour recording, and at
    // least the processor's own timeout.
    visibilityTimeout: Duration.minutes(16),
    retentionPeriod: ephemeral ? Duration.days(1) : Duration.days(4),
    enforceSSL: true,
    deadLetterQueue: { queue: dlq, maxReceiveCount: 4 },
  });

  audioBucket.addEventNotification(
    s3.EventType.OBJECT_CREATED,
    new s3n.SqsDestination(ingestQueue),
    { prefix: 'audio/' },
  );

  // ApplyFn's own dead letter: reached only once ApplyFn itself has
  // exhausted every retry on both paths (the extracted files and the
  // Bedrock fallback). DlqReaperFn drains it and marks the recording
  // failed, the same as it already does for ingestDlq. extractDlq's own
  // redrive (below) also lands here — see that queue's comment for why.
  // Declared before extractDlq only because that redrive needs the
  // reference; nothing about this queue itself changed.
  const applyDlq = new sqs.Queue(scope, 'ApplyDlq', {
    retentionPeriod: ephemeral ? Duration.days(4) : Duration.days(14),
    visibilityTimeout: Duration.minutes(3),
    enforceSSL: true,
  });

  // ExtractFn's own dead letter: reached only once the agent has exhausted
  // every retry. ApplyFn consumes it directly (see mr20-stack.ts) and runs
  // the Bedrock fallback there, so a recording still reaches `ready` even
  // when the agent never produces valid output — which makes this a live
  // consumer queue for ApplyFn, not a parking lot, unlike every other queue
  // named "*Dlq" here. Without a redrive policy of its own, a message
  // ApplyFn keeps failing on redelivers for the full 14-day retention and
  // is then dropped silently: no `failed` marker, the recording stuck at
  // `transcribed`, and a manual retry refused with 409. It shares applyDlq
  // as that dead letter rather than getting a queue of its own: either
  // source failing means the same thing (ApplyFn gave up on this
  // recording), and the message body is the identical types.ExtractionRequest
  // shape either way (internal/apply.ExtractionPrefix's comment explains
  // why), so DlqReaperFn's existing applyDlq handling parses it unchanged —
  // no reaper wiring beyond this redrive is needed.
  const extractDlq = new sqs.Queue(scope, 'ExtractDlq', {
    retentionPeriod: ephemeral ? Duration.days(4) : Duration.days(14),
    visibilityTimeout: Duration.minutes(16),
    enforceSSL: true,
    deadLetterQueue: { queue: applyDlq, maxReceiveCount: 4 },
  });

  const extractQueue = new sqs.Queue(scope, 'ExtractQueue', {
    // Exceeds ExtractFn's own 900s (15 min) timeout — the same margin
    // ingestQueue keeps over ProcessorFn's.
    visibilityTimeout: Duration.minutes(16),
    retentionPeriod: ephemeral ? Duration.days(1) : Duration.days(4),
    enforceSSL: true,
    deadLetterQueue: { queue: extractDlq, maxReceiveCount: 4 },
  });

  const applyQueue = new sqs.Queue(scope, 'ApplyQueue', {
    // Exceeds ApplyFn's own 3-minute timeout by a minute — the same margin
    // ingestQueue keeps over ProcessorFn's. SQS's visibility clock starts at
    // receipt, slightly before the Lambda's own timeout clock, so equal
    // values risk a second delivery while the first invocation still runs.
    visibilityTimeout: Duration.minutes(4),
    retentionPeriod: ephemeral ? Duration.days(1) : Duration.days(4),
    enforceSSL: true,
    deadLetterQueue: { queue: applyDlq, maxReceiveCount: 4 },
  });

  return { table, audioBucket, ingestQueue, dlq, extractQueue, extractDlq, applyQueue, applyDlq };
}
