# CIM inventory change invalidates shared cash plans

Escrow revision and shared inventory revision are independent: CIM commit binds one escrow snapshot, while every confirmed or potentially inventory-changing action invalidates older CDM and CIM plans across the Cash Device Resource Group. Confirmed commit or retention advances the inventory generation after durable observation, execution-unknown blocks the group pending reconciliation, and returned cash-unit data never substitutes for the required after snapshot or conceals a discrepancy.
