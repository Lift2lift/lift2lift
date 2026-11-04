import { AwsClient } from 'npm:aws4fetch@1.0.20';

const REGION = Deno.env.get('AWS_REGION') ?? 'us-east-2';

/** Signed call to an AWS JSON API. Throws with awsType set on an AWS error. */
export async function callAws<T>(service: string, host: string, target: string, payload: unknown): Promise<T> {
  const aws = new AwsClient({
    accessKeyId: Deno.env.get('AWS_ACCESS_KEY_ID') ?? '',
    secretAccessKey: Deno.env.get('AWS_SECRET_ACCESS_KEY') ?? '',
    region: REGION,
    service,
  });
  const res = await aws.fetch(`https://${host}.${REGION}.amazonaws.com/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': target },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`${target} ${res.status}`), { awsType: String(body.__type ?? '') });
  return body as T;
}

export function decodeBase64(value: unknown) {
  if (typeof value !== 'string' || !value) return null;
  try {
    return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
