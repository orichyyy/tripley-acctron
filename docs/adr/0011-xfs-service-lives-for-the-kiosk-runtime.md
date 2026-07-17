# XFS service lives for the kiosk runtime

Hostd transport, the XFS client, and XFS device service are created once for a hostd-mode kiosk runtime and are not rebuilt for operations or route changes. Connection loss fails closed and interrupts dependent work; reconnect or mode change requires an explicit runtime reboot after safe cleanup, while browser code never owns the native host process. This prevents duplicated XFS sessions and requests, and keeps the installed simulator provider's one-cycle limitation as an environment diagnostic rather than a framework contract.
