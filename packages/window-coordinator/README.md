# @tripley-acctron/window-coordinator

Window coordination ports and skeleton implementations.

- `HeadlessWindowManager` keeps windows and messages in memory for tests and headless flows.
- `NativeWindowManagerSkeleton` intentionally throws until `tripley-native` exposes window IDL.

All cross-window behavior should go through `WindowManagerPort` instead of directly calling another window.
