// Stand-in for @coinbase/cdp-sdk, a server SDK that Coinbase's Base Account package imports only for its payment and
// subscription helpers. HOODX never calls them (see next.config.ts); this keeps the SDK and its optional deps out of the bundle.
export class CdpClient {
  constructor() {
    throw new Error("CdpClient is not available in the HOODX app");
  }
}
