/**
 * The lyzn.ai marketing site: a private S3 bucket behind CloudFront.
 *
 * The site itself lives in web/ and is built by CI, which syncs the Vite
 * output into the bucket and invalidates the distribution. Nothing here
 * uploads content — the stack owns the infrastructure, the workflow owns
 * what is in it.
 *
 * It is defined in this package because backend/ is where the CDK app lives;
 * there is one app, two stacks, rather than a second toolchain under web/.
 */
import { Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

export interface LyznWebStackProps extends StackProps {
  /**
   * Every host this distribution answers to, e.g. ['lyzn.ai'].
   *
   * Listed rather than derived because www cannot be served yet: it is a CNAME
   * to Vercel, and Vercel's target publishes CAA records naming four issuers,
   * none of them Amazon. CAA is followed through the CNAME, so ACM is refused
   * for www until www stops pointing at Vercel — and a name holding a CNAME
   * cannot hold a CAA of its own to override it. Add www here, on a widened
   * certificate, once the apex cutover is done and www is repointed.
   *
   * Order matters when adding it, and it is not the order one would guess:
   * www has to stop pointing at Vercel *first*, because CAA is what blocks
   * the certificate and CAA is read through the CNAME. Repoint it at this
   * distribution, then request the certificate, then widen this list. See
   * docs/www-and-downloads.md.
   *
   * Optional, with certificateArn: leave both unset and the distribution
   * serves on its own cloudfront.net address. That is the state to deploy
   * first — the site can be built, synced and checked end to end there while
   * lyzn.ai is still served by Vercel, so attaching the domain later is a DNS
   * change against something already known to work.
   */
  readonly domainNames?: string[];
  /**
   * Certificate covering both hosts. Must be in us-east-1 — CloudFront reads
   * certificates from there regardless of where the stack is deployed. DNS for
   * lyzn.ai is at Cloudflare, so it is validated by hand and passed in by ARN
   * rather than issued and validated here.
   */
  readonly certificateArn?: string;
}

export class LyznWebStack extends Stack {
  constructor(scope: Construct, id: string, props: LyznWebStackProps) {
    super(scope, id, props);

    // RETAIN: the bucket is reproducible from git, but a stack delete taking
    // the live site's contents with it is not a failure mode worth having.
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const customDomain =
      props.domainNames?.length && props.certificateArn
        ? {
            domainNames: props.domainNames,
            certificate: acm.Certificate.fromCertificateArn(
              this,
              'SiteCertificate',
              props.certificateArn,
            ),
          }
        : {};

    /**
     * www goes to the apex, rather than serving the same site twice.
     *
     * The canonical link in web/index.html names https://lyzn.ai/, so a www
     * that answered with the same pages would be the same site at two
     * addresses with one of them declaring itself the other — which is a
     *301's job, done in the wrong place. This is a viewer-request function,
     * so the redirect happens at the edge and never reaches the bucket.
     *
     * Only created when www is actually being served. It is attached to the
     * behaviour either way; without www in domainNames the host can never
     * match and the function is a no-op on every request.
     */
    const redirectWww = new cloudfront.Function(this, 'RedirectWww', {
      comment: 'www.lyzn.ai → lyzn.ai, 301',
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var host = request.headers.host ? request.headers.host.value : '';
  if (host.slice(0, 4) !== 'www.') return request;

  // The query string arrives as an object and has to be put back together.
  // A dropped ?plan= would send somebody who followed a link to the wrong
  // tier, silently.
  var query = [];
  for (var name in request.querystring) {
    var value = request.querystring[name].value;
    query.push(value === '' ? name : name + '=' + value);
  }

  return {
    statusCode: 301,
    statusDescription: 'Moved Permanently',
    headers: {
      location: { value: 'https://' + host.slice(4) + request.uri + (query.length ? '?' + query.join('&') : '') },
    },
  };
}
      `),
    });

    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        functionAssociations: [
          {
            function: redirectWww,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
        // Origin access control: the bucket stays private and only this
        // distribution can read it.
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        compress: true,
      },
      ...customDomain,
      defaultRootObject: 'index.html',
      // The site is a single-page app: React Router owns the paths, so every
      // miss has to reach index.html rather than CloudFront's own error page.
      // This is the same rewrite web/vercel.json declares for Vercel.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
      // 200 includes the Indian edge locations; 100 is US/EU only, which is
      // the wrong shape for this audience.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    });

    new CfnOutput(this, 'SiteBucketName', { value: siteBucket.bucketName });
    new CfnOutput(this, 'SiteDistributionId', { value: distribution.distributionId });
    // The value to point lyzn.ai and www.lyzn.ai at, in Cloudflare.
    new CfnOutput(this, 'SiteDistributionDomain', {
      value: distribution.distributionDomainName,
    });
  }
}
