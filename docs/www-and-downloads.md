# www.lyzn.ai, and where the desktop downloads live

Two things that touch DNS and one that does not. The second and third are
done; the first needs somebody with the Cloudflare account open.

## 1. Pointing www at the site — needs Cloudflare

Today `lyzn.ai` is CloudFront over S3, deployed by `.github/workflows/web-ci.yml`,
and `www.lyzn.ai` is a **CNAME to Vercel** serving a stale copy of the site
from a deployment nobody updates.

**The order below is not the obvious one, and it matters.** The certificate is
the blocker, and what blocks it is CAA: `www.lyzn.ai` is a CNAME into Vercel's
zone, that zone publishes CAA records naming sectigo, globalsign, letsencrypt
and pki.goog — and not Amazon — and CAA is read *through* a CNAME. So ACM will
refuse to issue for www while Vercel holds the name, no matter what validation
records exist. www has to leave Vercel first, and it is unreachable for the few
minutes between leaving and the alias being attached.

A certificate covering both names is already requested and waiting for its
records:

```
arn:aws:acm:us-east-1:788655295054:certificate/f12003b8-e927-4c80-bb23-9e2bf84fb1c8
```

### At Cloudflare, in one visit

Delete the `www` CNAME that points at `c9a874172416e6d8.vercel-dns-017.com`, and
add these three records. All of them **DNS only** — grey cloud, not orange: a
proxied record hides the origin from ACM and terminates TLS at Cloudflare
instead of at CloudFront.

| Type | Name | Value |
|---|---|---|
| CNAME | `www` | `d2ehpip456okzq.cloudfront.net` |
| CNAME | `_7f06b102a9d5d6ca62dd8f9b10d6292b` | `_fe1538f81eb66bedfa923741779e65b8.jkddzztszm.acm-validations.aws` |
| CNAME | `_48152a8ac2f3f05e61abc8e95e63b0a9.www` | `_67c93fe93be8c7171d493bc9d0e91242.jkddzztszm.acm-validations.aws` |

The first two are ACM's; Cloudflare will append the zone name itself, so paste
the names exactly as written above without `.lyzn.ai`.

### Then, from a machine with AWS credentials

Watch for issuance — it is usually minutes once the CNAMEs resolve:

```bash
aws acm describe-certificate --region us-east-1 \
  --certificate-arn arn:aws:acm:us-east-1:788655295054:certificate/f12003b8-e927-4c80-bb23-9e2bf84fb1c8 \
  --query 'Certificate.Status' --output text
```

When it says `ISSUED`, widen the distribution. The defaults live in
`backend/bin/app.ts`; change them there and let the backend workflow deploy, or
deploy once by hand:

```bash
cd backend
npx cdk deploy LyznWebStack \
  -c webDomainNames=lyzn.ai,www.lyzn.ai \
  -c webCertificateArn=arn:aws:acm:us-east-1:788655295054:certificate/f12003b8-e927-4c80-bb23-9e2bf84fb1c8
```

`www` then **301s to the apex** rather than serving the site twice — the
canonical link in `web/index.html` names `https://lyzn.ai/`, and a second
address answering with the same pages while declaring itself the first is a
redirect that has not been written. It is a CloudFront viewer-request function
in `backend/lib/web-stack.ts`, already deployed and already inert: without www
in `domainNames` the host can never match.

Afterwards the Vercel project can be deleted. Nothing points at it.

## 2. The desktop app's downloads — done

`.github/workflows/desktop-release.yml` builds the daemon on one runner per
operating system and, on a `desktop-v*` tag, publishes the installers to the
website's own bucket:

```
lyzn.ai/downloads/LYZN-Daemon-mac-arm64.dmg
lyzn.ai/downloads/LYZN-Daemon-mac-x64.dmg
lyzn.ai/downloads/LYZN-Daemon-windows-x64.exe
lyzn.ai/downloads/LYZN-Daemon-linux-x64.AppImage
lyzn.ai/downloads/latest.json
lyzn.ai/downloads/v<version>/…          the same four, kept
```

Not a GitHub release: this repository is private, so a release asset is a
download that asks a stranger to log in.

To cut one:

```bash
# desktop/package.json version and the tag must agree; the workflow checks.
git tag desktop-v0.1.0
git push origin desktop-v0.1.0
```

Or run the workflow by hand with **Publish** ticked, which is the same thing
without a tag.

Two things worth knowing:

- **All three or nothing.** The build matrix tolerates one platform failing,
  because two artifacts are better than none. The publish job does not: it
  needs every leg green, and it checks all four files are present before it
  uploads anything. A release quietly missing Windows is worse than no release.
- **The site deploy must never delete them.** `web-ci.yml` syncs `dist` with
  `--delete`, which would take every installer off the site the next time
  somebody changed a heading. It excludes `downloads/*` for exactly that
  reason. If that exclude is ever removed, the downloads go with it.

## 3. The page — done

`lyzn.ai/daemon`, in `web/src/pages/Daemon.tsx`. It reads `latest.json` to
say which version it is offering, orders the four builds by what the user
agent suggests, and when there is no release yet it says so rather than
offering four buttons that would 404.

Nothing is code-signed, so the page tells people what Gatekeeper and
SmartScreen are about to say before they see it. That paragraph comes out the
day there is a Developer ID and an EV certificate, and not before.
