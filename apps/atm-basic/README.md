# atm-basic

Minimal ATM transaction example for Milestone 10.

The flow uses `Recipes.inputAccount` to capture an account number, stores it in transaction data,
then sends an `account.inquiry` host request and routes to success, declined, cancelled, timeout,
or failed ends.
