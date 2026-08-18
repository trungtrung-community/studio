# DIP Example

High-level policy (which alarms matter, how to render them) must not depend on low-level
mechanism (Mongoose, `fetch`, `localStorage`). Both depend on a port. The same move works on the
backend and the frontend — the only difference is _where you wire the concretes together_.

`Alarm` below is a plain domain type shared by both halves.

---

## Backend — Node / Express + Apollo

### Before — DIP Violation

```typescript
// resolvers.ts — business logic welded to Mongoose + an HTTP SDK
import {AlarmModel} from '../models/alarm';
import {Analytics} from '@segment/analytics-node';

const analytics = new Analytics({writeKey: process.env.SEGMENT_KEY!});

export const resolvers = {
  Query: {
    activeAlarms: async (_: unknown, {facilityId}: {facilityId: string}) => {
      const alarms = await AlarmModel.find({facilityId, status: 'active'}).lean();
      analytics.track({event: 'alarms_viewed', userId: facilityId});
      return alarms.filter(a => a.severity >= 3);
    },
  },
};
```

Problems: the `severity >= 3` rule is welded to Mongoose, Segment, and import-time singletons.
You can't unit-test the rule without a live DB and network, and swapping the data store edits
business logic.

### After — DIP Applied

```typescript
// ports — plain interfaces, no framework
export interface AlarmRepository {
  findActive(facilityId: string): Promise<Alarm[]>;
}
export interface Analytics {
  track(event: string, props?: Record<string, unknown>): void;
}

// use case — depends only on ports
export class GetActiveAlarms {
  constructor(
    private readonly alarms: AlarmRepository,
    private readonly analytics: Analytics,
  ) {}

  async execute(facilityId: string): Promise<Alarm[]> {
    const active = await this.alarms.findActive(facilityId);
    this.analytics.track('alarms_viewed', {facilityId});
    return active.filter(a => a.severity >= 3);
  }
}

// adapter — the only place Mongoose is named
export class MongoAlarmRepository implements AlarmRepository {
  findActive(facilityId: string): Promise<Alarm[]> {
    return AlarmModel.find({facilityId, status: 'active'}).lean();
  }
}

// composition root — wire concretes once (e.g. src/context.js)
const getActiveAlarms = new GetActiveAlarms(
  new MongoAlarmRepository(),
  new SegmentAnalytics(process.env.SEGMENT_KEY!),
);

// resolver becomes a thin delegate
export const resolvers = {
  Query: {
    activeAlarms: (_: unknown, {facilityId}: {facilityId: string}) =>
      getActiveAlarms.execute(facilityId),
  },
};
```

Now the rule is testable with an in-memory `AlarmRepository` fake and a spy analytics — no Mongo,
no network. The composition root is the only file that mentions Mongoose or Segment.

---

## Frontend — React (web)

### Before — DIP Violation

```tsx
// AlarmList.tsx — component welded to fetch + localStorage
export function AlarmList({facilityId}: {facilityId: string}) {
  const [alarms, setAlarms] = useState<Alarm[]>([]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    fetch(`/api/facilities/${facilityId}/alarms`, {
      headers: {Authorization: `Bearer ${token}`},
    })
      .then(r => r.json())
      .then(setAlarms);
  }, [facilityId]);

  return (
    <ul>
      {alarms.map(a => (
        <li key={a.id}>{a.name}</li>
      ))}
    </ul>
  );
}
```

Problems: the component knows about HTTP, the URL shape, and where the token is stored. You can't
render it in a test or Storybook without a real network and a populated `localStorage`.

### After — DIP Applied

```tsx
// port — what the component needs, not how it's fetched
export interface AlarmApi {
  listActive(facilityId: string): Promise<Alarm[]>;
}

const AlarmApiContext = createContext<AlarmApi | null>(null);
export const useAlarmApi = () => {
  const api = useContext(AlarmApiContext);
  if (!api) throw new Error('AlarmApiProvider missing');
  return api;
};

// component depends on the port via context — no fetch, no localStorage
export function AlarmList({facilityId}: {facilityId: string}) {
  const api = useAlarmApi();
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  useEffect(() => {
    api.listActive(facilityId).then(setAlarms);
  }, [api, facilityId]);
  return (
    <ul>
      {alarms.map(a => (
        <li key={a.id}>{a.name}</li>
      ))}
    </ul>
  );
}

// adapter — HTTP details live here, in one place
export class HttpAlarmApi implements AlarmApi {
  constructor(private readonly getToken: () => string | null) {}
  async listActive(facilityId: string): Promise<Alarm[]> {
    const res = await fetch(`/api/facilities/${facilityId}/alarms`, {
      headers: {Authorization: `Bearer ${this.getToken()}`},
    });
    return res.json();
  }
}

// composition root — your app shell
<AlarmApiContext.Provider value={new HttpAlarmApi(() => localStorage.getItem('token'))}>
  <AlarmList facilityId={id} />
</AlarmApiContext.Provider>;

// in a test or Storybook, inject a fake — no network
<AlarmApiContext.Provider value={{listActive: async () => fakeAlarms}}>
  <AlarmList facilityId="f1" />
</AlarmApiContext.Provider>;
```

---

**Same principle, two boundaries.** The high-level code never imports the low-level mechanism.
The wiring point is a plain composition root on the backend and a Context provider (or props) on
the frontend. No DI container, decorators, or Symbol tokens required — in plain JS the ports are
JSDoc `@typedef`s and everything else is identical.
