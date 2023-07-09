export type TypedMessagePort<In, Out = In> = EventTarget & {
  /**
   * Posts a message through the channel. Objects listed in transfer are transferred, not just cloned, meaning that they are no longer usable on the sending side.
   *
   * Throws a "DataCloneError" DOMException if transfer contains duplicate objects or port, or if message could not be cloned.
   */
  postMessage(message: Out): void
  addEventListener(
    type: "message",
    listener: (this: TypedMessagePort<In, Out>, ev: MessageEvent<In>) => void
  ): void
  removeEventListener(
    type: "message",
    listener: (this: TypedMessagePort<In, Out>, ev: MessageEvent<In>) => void
  ): void

  /** Disconnects the port, so that it is no longer active. */
  close(): void
  /** Begins dispatching messages received on the port. */
  start(): void

  onmessage:
    | ((this: TypedMessagePort<In, Out>, ev: MessageEvent<In>) => any)
    | null
}

export type TypedMessageChannel<In, Out = In> = {
  readonly port1: TypedMessagePort<In, Out>
  readonly port2: TypedMessagePort<Out, In>
}

export const TypedMessageChannel = MessageChannel as {
  new <T>(): TypedMessageChannel<T>
  new <In, Out>(): TypedMessageChannel<In, Out>
  prototype: MessageChannel
}

