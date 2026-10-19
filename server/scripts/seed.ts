// Seeds SugarCRM (SuiteCRM) with demo data. Safe to run again: existing records are skipped.
// Salesforce Developer orgs already ship with sample data, so after the first sync both CRMs hold both sets.
// "Burlington Textiles Corp of America" also exists in the Salesforce sample data on purpose:
// the first sync links the two copies by name instead of creating a duplicate.

import { SugarConnector } from '../src/connectors/sugar.ts';
import { getEntityMap } from '../src/mapping/fieldMaps.ts';

const sugar = new SugarConnector();
const accounts = getEntityMap('accounts');
const leads = getEntityMap('leads');
const opps = getEntityMap('opportunities');

const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

const accountData = [
  { name: 'Northwind Logistics', account_type: 'Customer', industry: 'Transportation', phone_office: '+1 312 555 0141', website: 'northwind.example.com', billing_address_city: 'Chicago', billing_address_state: 'IL', billing_address_country: 'USA', annual_revenue: 48000000, employees: 420 },
  { name: 'Blue Harbor Health', account_type: 'Prospect', industry: 'Healthcare', phone_office: '+1 617 555 0182', website: 'blueharbor.example.com', billing_address_city: 'Boston', billing_address_state: 'MA', billing_address_country: 'USA', annual_revenue: 120000000, employees: 1500 },
  { name: 'Lahore Textile Mills', account_type: 'Customer', industry: 'Manufacturing', phone_office: '+92 42 555 0101', website: 'ltm.example.com', billing_address_city: 'Lahore', billing_address_country: 'Pakistan', annual_revenue: 32000000, employees: 900 },
  { name: 'Summit Analytics', account_type: 'Partner', industry: 'Technology', phone_office: '+1 415 555 0199', website: 'summit-analytics.example.com', billing_address_city: 'San Francisco', billing_address_state: 'CA', billing_address_country: 'USA', annual_revenue: 15000000, employees: 85 },
  { name: 'Crescent Bank', account_type: 'Prospect', industry: 'Banking', phone_office: '+971 4 555 0123', website: 'crescentbank.example.com', billing_address_city: 'Dubai', billing_address_country: 'UAE', annual_revenue: 900000000, employees: 5200 },
  { name: 'Greenfield Energy', account_type: 'Reseller', industry: 'Energy', phone_office: '+1 713 555 0110', website: 'greenfield.example.com', billing_address_city: 'Houston', billing_address_state: 'TX', billing_address_country: 'USA', annual_revenue: 76000000, employees: 640 },
  { name: 'Burlington Textiles Corp of America', account_type: 'Customer', industry: 'Apparel', phone_office: '(336) 222-7000', website: 'www.burlington.com', billing_address_city: 'Burlington', billing_address_state: 'NC', billing_address_country: 'USA' },
];

const leadData = [
  { first_name: 'Sara', last_name: 'Malik', title: 'VP of Operations', account_name: 'Indus Retail Group', email1: 'sara.malik@indusretail.example.com', phone_work: '+92 21 555 0177', status: 'New', lead_source: 'Web Site', primary_address_city: 'Karachi', primary_address_country: 'Pakistan' },
  { first_name: 'James', last_name: 'Okafor', title: 'Director of IT', account_name: 'Lagos Freight', email1: 'j.okafor@lagosfreight.example.com', phone_work: '+234 1 555 0144', status: 'In Process', lead_source: 'Partner', primary_address_city: 'Lagos', primary_address_country: 'Nigeria' },
  { first_name: 'Emily', last_name: 'Chen', title: 'Operations Manager', account_name: 'Pacific Foods', email1: 'emily.chen@pacificfoods.example.com', status: 'New', lead_source: 'Trade Show', primary_address_city: 'Seattle', primary_address_country: 'USA' },
  { first_name: 'Omar', last_name: 'Haddad', title: 'CTO', account_name: 'Levant Software', email1: 'omar@levantsoft.example.com', phone_mobile: '+961 3 555 012', status: 'Assigned', lead_source: 'Web Site', primary_address_city: 'Beirut', primary_address_country: 'Lebanon' },
  { first_name: 'Lucy', last_name: 'Grant', title: 'Office Administrator', account_name: 'Grant & Sons', email1: 'lucy@grantsons.example.com', status: 'New', lead_source: 'Cold Call' },
  { first_name: 'Daniel', last_name: 'Rossi', title: 'Head of Procurement', account_name: 'Milano Design Studio', email1: 'd.rossi@milanodesign.example.com', phone_work: '+39 02 555 0188', status: 'In Process', lead_source: 'Conference', primary_address_city: 'Milan', primary_address_country: 'Italy' },
  { first_name: 'Ayesha', last_name: 'Khan', title: 'Founder', account_name: 'Khan Analytics', email1: 'ayesha@khananalytics.example.com', phone_work: '+92 51 555 0133', status: 'New', lead_source: 'Partner', primary_address_city: 'Islamabad', primary_address_country: 'Pakistan' },
  { first_name: 'Tom', last_name: 'Becker', title: 'Analyst', account_name: 'Becker Consulting', email1: 'tom@beckerconsulting.example.com', status: 'Dead', lead_source: 'Email' },
];

// account is looked up by name after accounts are created
const oppData = [
  { name: 'Northwind - Fleet Tracking Rollout', account: 'Northwind Logistics', amount: 85000, date_closed: daysFromNow(30), sales_stage: 'Value Proposition', opportunity_type: 'New Business', lead_source: 'Web Site', next_step: 'Send ROI model' },
  { name: 'Blue Harbor - Patient Portal', account: 'Blue Harbor Health', amount: 240000, date_closed: daysFromNow(45), sales_stage: 'Proposal/Price Quote', opportunity_type: 'New Business', lead_source: 'Partner', next_step: 'Security review with CISO' },
  { name: 'Lahore Textile - ERP Integration', account: 'Lahore Textile Mills', amount: 64000, date_closed: daysFromNow(-10), sales_stage: 'Negotiation/Review', opportunity_type: 'Existing Business', lead_source: 'Existing Customer', next_step: 'Final pricing call' },
  { name: 'Summit - Partner Reseller Deal', account: 'Summit Analytics', amount: 30000, date_closed: daysFromNow(-5), sales_stage: 'Closed Won', opportunity_type: 'New Business', lead_source: 'Partner' },
  { name: 'Crescent Bank - CRM Modernization', account: 'Crescent Bank', amount: 650000, date_closed: daysFromNow(60), sales_stage: 'Negotiation/Review', opportunity_type: 'New Business', lead_source: 'Conference', next_step: 'Legal redlines' },
  { name: 'Greenfield - Field Service App', account: 'Greenfield Energy', amount: 120000, date_closed: daysFromNow(20), sales_stage: 'Id. Decision Makers', opportunity_type: 'New Business', lead_source: 'Cold Call' },
  { name: 'Northwind - Support Renewal', account: 'Northwind Logistics', amount: 18000, date_closed: daysFromNow(-20), sales_stage: 'Closed Lost', opportunity_type: 'Existing Business', lead_source: 'Existing Customer' },
  { name: 'Lahore Textile - Analytics Add-on', account: 'Lahore Textile Mills', amount: 22000, date_closed: daysFromNow(15), sales_stage: 'Qualification', opportunity_type: 'Existing Business', lead_source: 'Existing Customer' },
];

async function ensure(map: typeof accounts, fields: Record<string, unknown>, label: string) {
  const existing = await sugar.findByNaturalKey(map, fields);
  if (existing) {
    console.log(`  = ${label}`);
    return existing.id;
  }
  const id = await sugar.create(map, fields);
  console.log(`  + ${label}`);
  return id;
}

console.log('Accounts');
const accountIds = new Map<string, string>();
for (const a of accountData) accountIds.set(a.name, await ensure(accounts, a, a.name));

console.log('Leads');
for (const l of leadData) await ensure(leads, l, `${l.first_name} ${l.last_name}`);

console.log('Opportunities');
for (const { account, ...o } of oppData) await ensure(opps, { ...o, account_id: accountIds.get(account) }, o.name);

console.log('\nSugarCRM demo data ready.');
