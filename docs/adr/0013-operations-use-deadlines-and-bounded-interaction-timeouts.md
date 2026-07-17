# Operations use absolute deadlines and bounded interaction timeouts

Each customer operation has an absolute deadline plus named interaction timeouts and attempt budgets for individual stages. Valid activity may renew a stage's idle timeout, and bounded accessibility policy may extend it, but validation reentry cannot reset the operation deadline or authentication limits; technical service timeouts remain distinct. Media-custody compensation may continue beyond the business deadline because physical customer safety cannot be abandoned when the timer expires.
