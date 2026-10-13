import { ViewTransition } from "react";

export default function MainTemplate({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition
      enter={{
        "nav-forward": "nav-forward",
        "nav-back": "nav-back",
        default: "page-in",
      }}
      exit={{
        "nav-forward": "nav-forward",
        "nav-back": "nav-back",
        default: "page-out",
      }}
      default="none"
    >
      {children}
    </ViewTransition>
  );
}
