/**
 * 极简事件总线（类型安全的泛型版本）
 * 用途：
 * - Hover Probe：抛出 tooltip 数据
 * - Click Query：抛出固定查询点数据
 *
 * 设计原则：不引入框架依赖（Vue/Pinia），便于算法层复用与 WebWorker 化迁移。
 */

export type EventHandler<T> = (payload: T) => void;

export class EventBus<EventMap extends Record<string, unknown>> {
  private handlers = new Map<keyof EventMap, Set<EventHandler<any>>>();

  on<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as any);
    return () => this.off(event, handler);
  }

  off<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): void {
    const set = this.handlers.get(event);
    if (!set) return;
    set.delete(handler as any);
    if (set.size === 0) this.handlers.delete(event);
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of set) h(payload);
  }
}

