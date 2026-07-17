# CDM denomination plans are opaque and one-use

Applications express cash amounts as currency plus integer minor units, while XFS Device Service retains native denomination values, mix details, teller identity, output position, and cash-unit binding behind a short-lived plan ID. A plan is bound to one operation and service/session generation, invalidates on expiry or relevant cash-unit change, and can be consumed only once; detailed cash-unit inventory is exposed only through a separate maintenance capability rather than customer runtime or ordinary diagnostics.
