// Field mapping between SugarCRM (SuiteCRM) modules and Salesforce objects.
// Adding a new synced object means adding one entry here; the sync engine is generic.

import { countryToSf, usStateToSf } from './addressValues.ts';

export type EntityName = 'accounts' | 'leads' | 'opportunities' | 'dealReviews';

export type FieldType = 'string' | 'number' | 'integer' | 'date' | 'ref';

export interface FieldMap {
  sugar: string;
  sf: string;
  type?: FieldType; // default 'string'
  ref?: EntityName; // for type 'ref': which entity the id points to
  toSf?: Record<string, string | null>; // picklist translation Sugar -> Salesforce
  toSugar?: Record<string, string | null>; // picklist translation Salesforce -> Sugar
  sfDefault?: string | number; // used when Salesforce requires a value but Sugar has none
  sugarDefault?: string | number; // used when Sugar requires a value but Salesforce has none
}

export interface EntityMap {
  name: EntityName;
  sugarModule: string;
  sfObject: string;
  // Fields used to find an existing match on first sync (avoids duplicates)
  naturalKey: { sugar: string; sf: string }[];
  // Extra SOQL filter for records we should not touch (e.g. converted leads are read-only)
  sfFilter?: string;
  fields: FieldMap[];
}

const industryToSugar = { Agriculture: 'Other', 'Food & Beverage': 'Other' };

export const ENTITY_MAPS: EntityMap[] = [
  {
    name: 'accounts',
    sugarModule: 'Accounts',
    sfObject: 'Account',
    naturalKey: [{ sugar: 'name', sf: 'Name' }],
    fields: [
      { sugar: 'name', sf: 'Name' },
      {
        sugar: 'account_type',
        sf: 'Type',
        toSf: {
          Customer: 'Customer - Direct',
          Partner: 'Technology Partner',
          Reseller: 'Channel Partner / Reseller',
          Integrator: 'Installation Partner',
          Prospect: 'Prospect',
          Analyst: 'Other',
          Competitor: 'Other',
          Investor: 'Other',
          Press: 'Other',
          Other: 'Other',
        },
        toSugar: {
          'Customer - Direct': 'Customer',
          'Customer - Channel': 'Customer',
          'Channel Partner / Reseller': 'Reseller',
          'Installation Partner': 'Integrator',
          'Technology Partner': 'Partner',
          Prospect: 'Prospect',
          Other: 'Other',
        },
      },
      { sugar: 'industry', sf: 'Industry', toSugar: industryToSugar },
      { sugar: 'phone_office', sf: 'Phone' },
      { sugar: 'website', sf: 'Website' },
      { sugar: 'billing_address_street', sf: 'BillingStreet' },
      { sugar: 'billing_address_city', sf: 'BillingCity' },
      { sugar: 'billing_address_state', sf: 'BillingState', toSf: usStateToSf },
      { sugar: 'billing_address_postalcode', sf: 'BillingPostalCode' },
      { sugar: 'billing_address_country', sf: 'BillingCountry', toSf: countryToSf },
      { sugar: 'annual_revenue', sf: 'AnnualRevenue', type: 'number' },
      { sugar: 'employees', sf: 'NumberOfEmployees', type: 'integer' },
      { sugar: 'description', sf: 'Description' },
    ],
  },
  {
    name: 'leads',
    sugarModule: 'Leads',
    sfObject: 'Lead',
    naturalKey: [{ sugar: 'email1', sf: 'Email' }],
    sfFilter: 'IsConverted = false',
    fields: [
      { sugar: 'first_name', sf: 'FirstName' },
      { sugar: 'last_name', sf: 'LastName' },
      { sugar: 'title', sf: 'Title' },
      { sugar: 'account_name', sf: 'Company', sfDefault: '[Not Provided]' },
      { sugar: 'email1', sf: 'Email' },
      { sugar: 'phone_work', sf: 'Phone' },
      { sugar: 'phone_mobile', sf: 'MobilePhone' },
      {
        sugar: 'status',
        sf: 'Status',
        sfDefault: 'Open - Not Contacted',
        toSf: {
          New: 'Open - Not Contacted',
          Assigned: 'Open - Not Contacted',
          'In Process': 'Working - Contacted',
          Recycled: 'Working - Contacted',
          Dead: 'Closed - Not Converted',
          // Salesforce only allows a "converted" status through its lead convert process,
          // so a converted Sugar lead keeps whatever status it has in Salesforce.
          Converted: null,
        },
        toSugar: {
          'Open - Not Contacted': 'New',
          'Working - Contacted': 'In Process',
          'Closed - Converted': 'Converted',
          'Closed - Not Converted': 'Dead',
        },
      },
      {
        sugar: 'lead_source',
        sf: 'LeadSource',
        toSf: {
          'Web Site': 'Web',
          'Cold Call': 'Phone Inquiry',
          Partner: 'Partner Referral',
        },
        toSugar: {
          Web: 'Web Site',
          'Phone Inquiry': 'Cold Call',
          'Partner Referral': 'Partner',
          'Purchased List': 'Other',
        },
      },
      { sugar: 'primary_address_street', sf: 'Street' },
      { sugar: 'primary_address_city', sf: 'City' },
      { sugar: 'primary_address_state', sf: 'State', toSf: usStateToSf },
      { sugar: 'primary_address_postalcode', sf: 'PostalCode' },
      { sugar: 'primary_address_country', sf: 'Country', toSf: countryToSf },
      { sugar: 'description', sf: 'Description' },
    ],
  },
  {
    name: 'opportunities',
    sugarModule: 'Opportunities',
    sfObject: 'Opportunity',
    naturalKey: [{ sugar: 'name', sf: 'Name' }],
    fields: [
      { sugar: 'name', sf: 'Name' },
      { sugar: 'account_id', sf: 'AccountId', type: 'ref', ref: 'accounts' },
      { sugar: 'amount', sf: 'Amount', type: 'number', sugarDefault: 0 },
      { sugar: 'date_closed', sf: 'CloseDate', type: 'date' },
      // Sugar and Salesforce ship with the same default sales stages
      { sugar: 'sales_stage', sf: 'StageName', sfDefault: 'Prospecting', sugarDefault: 'Prospecting' },
      { sugar: 'probability', sf: 'Probability', type: 'number' },
      {
        sugar: 'lead_source',
        sf: 'LeadSource',
        toSf: { 'Web Site': 'Web', 'Cold Call': 'Phone Inquiry', Partner: 'Partner Referral' },
        toSugar: { Web: 'Web Site', 'Phone Inquiry': 'Cold Call', 'Partner Referral': 'Partner', 'Purchased List': 'Other' },
      },
      {
        sugar: 'opportunity_type',
        sf: 'Type',
        toSf: { 'New Business': 'New Customer', 'Existing Business': 'Existing Customer - Upgrade' },
        toSugar: {
          'New Customer': 'New Business',
          'Existing Customer - Upgrade': 'Existing Business',
          'Existing Customer - Replacement': 'Existing Business',
          'Existing Customer - Downgrade': 'Existing Business',
        },
      },
      { sugar: 'next_step', sf: 'NextStep' },
      { sugar: 'description', sf: 'Description' },
    ],
  },
  {
    // Custom module on both sides: SuiteCRM "DealReviews" <-> Salesforce Deal_Review__c
    name: 'dealReviews',
    sugarModule: 'DealReviews',
    sfObject: 'Deal_Review__c',
    naturalKey: [{ sugar: 'name', sf: 'Name' }],
    fields: [
      { sugar: 'name', sf: 'Name' },
      { sugar: 'opportunity_id', sf: 'Opportunity__c', type: 'ref', ref: 'opportunities' },
      { sugar: 'review_status', sf: 'Review_Status__c', sfDefault: 'Pending', sugarDefault: 'Pending' },
      { sugar: 'risk_level', sf: 'Risk_Level__c' },
      { sugar: 'discount_percent', sf: 'Discount_Percent__c', type: 'number' },
      { sugar: 'reviewer_notes', sf: 'Reviewer_Notes__c' },
    ],
  },
];

export function getEntityMap(name: EntityName): EntityMap {
  const map = ENTITY_MAPS.find((e) => e.name === name);
  if (!map) throw new Error(`Unknown entity ${name}`);
  return map;
}

// Accounts must sync before anything that references them.
export const SYNC_ORDER: EntityName[] = ENTITY_MAPS.map((e) => e.name);
