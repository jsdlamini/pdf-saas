// Shared async-operation status. One type for every user-triggered async
// operation (compile, import, upload, conversions, save) so pending/error
// states are rendered consistently instead of via ad-hoc boolean flags.

export type AsyncStatus = "idle" | "pending" | "success" | "error";

export type AsyncState = {
  status: AsyncStatus;
  message: string;
};

export function idle(): AsyncState {
  return { status: "idle", message: "" };
}

export function pending(message = "Working…"): AsyncState {
  return { status: "pending", message };
}

export function success(message = "Done."): AsyncState {
  return { status: "success", message };
}

export function error(message: string): AsyncState {
  return { status: "error", message };
}

// Minimal reducer-style transition helpers so callers don't hand-roll the
// state machine. Import these alongside React's useState:
//   const [s, setS] = useState(idle());
//   setS(pending("Compiling…")); … setS(success("Compiled.")); … setS(error(msg))
export { error as setError };
