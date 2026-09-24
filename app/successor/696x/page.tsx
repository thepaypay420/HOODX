import {Hud} from '@/components/Hud';
import {ProportionalVaultDesk} from '@/components/ProportionalVaultDesk';
import {proportional696Release} from '@/lib/proportionalRelease';
export default function Successor696Page() {
  return <><Hud/><main className="relative z-10 mx-auto max-w-5xl px-4 py-8">
    {proportional696Release ? <ProportionalVaultDesk release={proportional696Release}/> : <section className="vault-actions"><p className="vault-eyebrow">696X / NEXT CHAPTER</p><h1 className="text-3xl">The broader basket is in testing.</h1><p>Entry will open after release checks and live recovery tests are complete. Your existing 696X shares remain in the current vault.</p><a className="landing-path-link" href="/i/696x">Open the current 696X vault →</a></section>}
  </main></>;
}
