# Card and QR are explicit entry methods that converge after acquisition

The withdrawal example uses card as its primary entry and QR as an explicitly selected alternative. Each entry method owns its acquisition lifecycle, then produces the same safe access-credential contract before entering shared validation, amount, and secure-PIN behavior; acquisition failure never silently switches methods. This avoids competing IDC and BCR sessions inside one input node and makes device locks, cancellation, timeout, and sensitive-data handling attributable to one operation.
