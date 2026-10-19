import { api } from '../api.ts';
import { useData } from '../useData.ts';
import { dateTime } from '../format.ts';

const RULES = [
  {
    id: 'hot-lead',
    name: 'Hot lead follow-up',
    when: 'A lead scores 70 or more (decision-maker title, email, phone, high-intent source, rating).',
    then: 'Creates a high-priority "call within 24h" task in Salesforce with the score breakdown.',
  },
  {
    id: 'closed-won-kickoff',
    name: 'Closed Won kickoff',
    when: 'An opportunity moves to Closed Won in either CRM.',
    then: 'Creates an onboarding kickoff task on the opportunity.',
  },
  {
    id: 'stale-deal',
    name: 'Deal at risk',
    when: 'An open opportunity is past its close date, or has had no updates for 14 days.',
    then: 'Creates a high-priority follow-up task so the owner updates the deal.',
  },
  {
    id: 'deal-review',
    name: 'Large deal review',
    when: 'An open deal of $100k+ reaches Proposal or Negotiation.',
    then: 'Opens a Deal Review (custom module) that syncs to SugarCRM for approval.',
  },
];

export function Automation({ version }: { version: number }) {
  const events = useData(api.workflows, [version]);
  const counts = new Map<string, number>();
  for (const e of events.data ?? []) counts.set(e.rule, (counts.get(e.rule) ?? 0) + 1);
  const ruleName = (id: string) => RULES.find((r) => r.id === id)?.name ?? id;

  return (
    <>
      <section className="grid rules">
        {RULES.map((r) => (
          <div className="card rule" key={r.id}>
            <h3>{r.name}</h3>
            <p>
              <strong>When:</strong> {r.when}
            </p>
            <p style={{ marginTop: 6 }}>
              <strong>Then:</strong> {r.then}
            </p>
            <div className="fired">Fired {counts.get(r.id) ?? 0} times (recent)</div>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Automation activity</h2>
        <p className="sub">Each rule fires once per record. Runs after every sync.</p>
        {!events.data ? (
          <div className="empty">{events.error ?? 'Loading…'}</div>
        ) : events.data.length === 0 ? (
          <div className="empty">No automation has fired yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Rule</th>
                  <th>Record</th>
                  <th>What happened</th>
                </tr>
              </thead>
              <tbody>
                {events.data.map((e) => (
                  <tr key={e._id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{dateTime(e.at)}</td>
                    <td>{ruleName(e.rule)}</td>
                    <td>{e.recordName}</td>
                    <td className="muted">{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
