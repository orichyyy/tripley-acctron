# Compound cash devices use resource-group fencing

CDM and CIM logical services that share a recycler mechanism belong to a configured Cash Device Resource Group and are mutually fenced across transaction, recovery, and maintenance ownership. Application locks alone cannot stop a stale runtime acting through another logical service, so hostd enforces the group mapping immediately before dispatch while retaining service-specific command whitelists; compound or recycle configuration without a group mapping fails fast.
