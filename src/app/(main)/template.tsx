import { ViewTransition } from "react";

export default function MainTemplate({ children }: { children: React.ReactNode }) {
  // Exit is skipped: animating the project canvas snapshot is expensive and leaves a
  // lingering old-page layer that bleeds into the next navigation.
  return (
    <ViewTransition
      enter={{
        "nav-forward": "nav-forward",
        "nav-back": "nav-back",
        default: "page-in",
      }}
      exit="none"
      default="none"
    >
      {children}
    </ViewTransition>
  );
}
