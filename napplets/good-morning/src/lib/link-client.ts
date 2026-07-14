import { link } from '@napplet/sdk';
import { isNapDomainPresent } from './runtime-domain';

export async function openExternalLink(url: string): Promise<boolean> {
  if (!isNapDomainPresent('link')) return false;

  try {
    const result = await link.open(url);
    return result.status === 'opened';
  } catch {
    return false;
  }
}
