# Host message timelines store only safe projections

Raw host bytes and complete decoded fields are operation-local data and never enter ordinary logs, traces, UI, Flow state, hooks, audit, or the transaction message timeline. The default repository stores only a profile-classified safe projection; keyed fingerprints and complete encrypted archives are separate injected capabilities that are disabled unless a bank explicitly configures their keys, access, retention, and audit policy.
