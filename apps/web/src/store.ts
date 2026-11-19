import { useMemo, useSyncExternalStore } from 'react'
import { makeInMemoryAdapter } from '@livestore/adapter-web'
import { createStorePromise, Events, makeSchema, queryDb, Schema, State } from '@livestore/livestore'
import type { ContractView, Summary, ResponseSchema } from '@clausid/contracts'
import { parseProjection } from './projection.ts'
import type { Store } from '@livestore/livestore'

const projections = State.SQLite.table({
  name: 'projections',
  columns: { id: State.SQLite.text({ primaryKey: true }), value: State.SQLite.text() },
})
const events = {
  received: Events.clientOnly({ name: 'v1.ProjectionReceived', schema: Schema.Struct({ id: Schema.String, value: Schema.String }) }),
  removed: Events.clientOnly({ name: 'v1.ProjectionRemoved', schema: Schema.Struct({ id: Schema.String }) }),
}
const materializers = State.SQLite.materializers(events, {
  'v1.ProjectionReceived': (row) => projections.insert(row).onConflict('id', 'replace'),
  'v1.ProjectionRemoved': ({ id }) => projections.delete().where({ id }),
})
const schema = makeSchema({ events, state: State.SQLite.makeState({ tables: { projections }, materializers }) })
export type AppStore = Store<typeof schema>

export function openStore() {
  return createStorePromise({ schema, adapter: makeInMemoryAdapter(), storeId: crypto.randomUUID() })
}
const projection = (id: string) => queryDb(projections.where({ id }).first())
export function project(store: AppStore, id: string, value: Summary[] | ContractView) {
  const encoded = JSON.stringify(value)
  if (store.query(projections.where({ id }).first())?.value !== encoded) {
    store.commit(events.received({ id, value: encoded }))
  }
}
export function clearProjection(store: AppStore, id: string) {
  store.commit(events.removed({ id }))
}

export function useProjection<T>(store: AppStore, id: string, schema: ResponseSchema<T>) {
  const query = useMemo(() => projection(id), [id])
  const source = useMemo(
    () => ({
      subscribe: (notify: () => void) => store.subscribe(query, notify),
      snapshot: () => store.query(query)?.value,
    }),
    [store, query],
  )
  const value = useSyncExternalStore(source.subscribe, source.snapshot)
  return useMemo(() => parseProjection(value, schema), [value, schema])
}
