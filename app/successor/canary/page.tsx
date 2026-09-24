import {notFound} from 'next/navigation';
import {getAddress,isAddress} from 'viem';
import {Hud} from '@/components/Hud';
import {ProportionalVaultDesk} from '@/components/ProportionalVaultDesk';

const implementation='0xDDC4084055Ae4d56f9Fa618A1Ccd962737F1aEf7' as const;
const factory='0xb0a89074d2f88207698aC99f39061463eeabeC8a' as const;

export default async function SuccessorCanaryPage({searchParams}:{searchParams:Promise<{vault?:string}>}) {
  if(process.env.HOODX_CANARY_UI!=='1') notFound();
  const value=(await searchParams).vault;
  if(!value||!isAddress(value)) notFound();
  const release={vault:getAddress(value),implementation,factory,slug:'696xcanary',launchBlock:0n};
  return <><Hud/><main className="relative z-10 mx-auto max-w-5xl px-4 py-8"><section className="vault-actions mb-6"><p className="vault-eyebrow">DISPOSABLE LIVE CANARY</p><h1 className="text-3xl">Recovery test only.</h1><p>This page accepts only the factory&apos;s exact <code>696xcanary</code> clone. Confirm every transaction in your wallet. Production remains disabled.</p></section><ProportionalVaultDesk release={release}/></main></>;
}
