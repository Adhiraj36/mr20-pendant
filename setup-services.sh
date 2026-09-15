#!/usr/bin/env bash
# One-time setup for the two external services the pipeline needs.
#
#   ./setup-services.sh deepgram <YOUR_KEY>   store the transcription key
#   ./setup-services.sh ses                   re-send the sender verification email
#   ./setup-services.sh status                check both
set -euo pipefail

REGION="${REGION:-ap-south-1}"
STACK="${STACK:-Mr20PendantStack}"

out() {
  aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

case "${1:-status}" in
  deepgram)
    KEY="${2:?usage: ./setup-services.sh deepgram <YOUR_DEEPGRAM_KEY>}"
    ARN=$(out DeepgramSecretArn)
    aws secretsmanager put-secret-value --region "$REGION" \
      --secret-id "$ARN" --secret-string "{\"apiKey\":\"$KEY\"}" \
      --query 'VersionId' --output text >/dev/null
    echo "stored. forcing the processor to pick it up..."
    # The key is cached per Lambda container; a config change recycles them.
    FN=$(aws lambda list-functions --region "$REGION" \
      --query "Functions[?contains(FunctionName,'ProcessorFn')].FunctionName" --output text)
    aws lambda update-function-configuration --region "$REGION" --function-name "$FN" \
      --environment "Variables={$(aws lambda get-function-configuration --region "$REGION" \
        --function-name "$FN" --query 'Environment.Variables' --output json \
        | python3 -c 'import json,sys;print(",".join(f"{k}={v}" for k,v in json.load(sys.stdin).items()))')}" \
      --query 'LastModified' --output text
    echo "done — new uploads will transcribe."
    ;;

  ses)
    EMAIL=$(out SenderEmail)
    aws sesv2 create-email-identity --region "$REGION" --email-identity "$EMAIL" 2>/dev/null \
      || aws sesv2 put-email-identity-configuration-set-attributes --region "$REGION" \
           --email-identity "$EMAIL" >/dev/null 2>&1 || true
    echo "verification email re-sent to $EMAIL"
    echo "open it and click the link, then run: ./setup-services.sh status"
    ;;

  status)
    EMAIL=$(out SenderEmail)
    echo "== SES sender: $EMAIL"
    aws sesv2 get-email-identity --region "$REGION" --email-identity "$EMAIL" \
      --query '{verified:VerifiedForSendingStatus}' --output text 2>/dev/null || echo "  identity missing"
    echo "== Deepgram key"
    aws secretsmanager get-secret-value --region "$REGION" --secret-id "$(out DeepgramSecretArn)" \
      --query SecretString --output text \
      | python3 -c "import json,sys;k=json.load(sys.stdin)['apiKey'];print('  NOT SET (still REPLACE_ME)' if k=='REPLACE_ME' else f'  set ({k[:6]}…{k[-4:]})')"
    ;;

  *) echo "usage: $0 {deepgram <key>|ses|status}"; exit 1 ;;
esac
