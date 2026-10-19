// One-time Salesforce setup through the Tooling API (safe to run again, it skips what exists):
//   - Sugar_Id__c external id field on Account, Lead, Opportunity (idempotent upserts)
//   - Deal_Review__c custom object (the custom module synced with SugarCRM)
//   - a "CRM Sync Hub" permission set granting access to all of the above, assigned to the integration user

import { SalesforceConnector, SUGAR_ID_FIELD } from '../src/connectors/salesforce.ts';

const sf = new SalesforceConnector();
const PERM_SET = 'CRM_Sync_Hub';

const sugarIdMetadata = {
  label: 'Sugar Id',
  type: 'Text',
  length: 36,
  externalId: true,
  unique: true,
  caseSensitive: false,
  description: 'Id of the matching SugarCRM record, set by the CRM Sync Hub',
};

function picklist(values: string[]) {
  return {
    restricted: true,
    valueSetDefinition: {
      sorted: false,
      value: values.map((v, i) => ({ fullName: v, label: v, default: i === 0 })),
    },
  };
}

const dealReviewFields: Record<string, any> = {
  Opportunity__c: {
    label: 'Opportunity',
    type: 'Lookup',
    referenceTo: 'Opportunity',
    relationshipName: 'Deal_Reviews',
    relationshipLabel: 'Deal Reviews',
    deleteConstraint: 'SetNull',
  },
  Review_Status__c: { label: 'Review Status', type: 'Picklist', valueSet: picklist(['Pending', 'Approved', 'Rejected']) },
  Risk_Level__c: { label: 'Risk Level', type: 'Picklist', valueSet: picklist(['Low', 'Medium', 'High']) },
  Discount_Percent__c: { label: 'Discount Percent', type: 'Percent', precision: 5, scale: 2 },
  Reviewer_Notes__c: { label: 'Reviewer Notes', type: 'LongTextArea', length: 32768, visibleLines: 5 },
  [SUGAR_ID_FIELD]: sugarIdMetadata,
};

// Tooling queries see fields even before anyone has permission to them (describe does not)
async function toolingQuery(soql: string): Promise<any[]> {
  const res = await sf.api<any>(`/tooling/query?q=${encodeURIComponent(soql)}`);
  return res.records;
}

/** Custom objects are referenced by their Tooling id, standard objects by name. */
async function tableId(object: string): Promise<string | null> {
  if (!object.endsWith('__c')) return object;
  const rows = await toolingQuery(`SELECT Id FROM CustomObject WHERE DeveloperName = '${object.replace(/__c$/, '')}'`);
  return rows[0]?.Id ?? null;
}

async function objectExists(object: string): Promise<boolean> {
  return (await tableId(object)) !== null;
}

async function fieldExists(object: string, field: string): Promise<boolean> {
  const table = await tableId(object);
  if (!table) return false;
  const rows = await toolingQuery(
    `SELECT Id FROM CustomField WHERE TableEnumOrId = '${table}' AND DeveloperName = '${field.replace(/__c$/, '')}'`,
  );
  return rows.length > 0;
}

async function createField(object: string, field: string, metadata: any) {
  if (await fieldExists(object, field)) {
    console.log(`  = ${object}.${field} already exists`);
    return;
  }
  await sf.api('/tooling/sobjects/CustomField', {
    method: 'POST',
    body: JSON.stringify({ FullName: `${object}.${field}`, Metadata: metadata }),
  });
  console.log(`  + created ${object}.${field}`);
}

async function ensurePermissionSet(): Promise<string> {
  const rows = await sf.query(`SELECT Id FROM PermissionSet WHERE Name = '${PERM_SET}'`);
  if (rows[0]) return rows[0].Id;
  const res = await sf.api<{ id: string }>('/sobjects/PermissionSet', {
    method: 'POST',
    body: JSON.stringify({ Name: PERM_SET, Label: 'CRM Sync Hub', Description: 'Access for the SugarCRM sync integration' }),
  });
  console.log('  + created permission set CRM Sync Hub');
  return res.id;
}

async function grantField(permSetId: string, object: string, field: string) {
  const fullName = `${object}.${field}`;
  const rows = await sf.query(`SELECT Id FROM FieldPermissions WHERE ParentId = '${permSetId}' AND Field = '${fullName}'`);
  if (rows[0]) return;
  await sf.api('/sobjects/FieldPermissions', {
    method: 'POST',
    body: JSON.stringify({ ParentId: permSetId, SobjectType: object, Field: fullName, PermissionsRead: true, PermissionsEdit: true }),
  });
}

async function grantObject(permSetId: string, object: string) {
  const rows = await sf.query(`SELECT Id FROM ObjectPermissions WHERE ParentId = '${permSetId}' AND SobjectType = '${object}'`);
  if (rows[0]) return;
  await sf.api('/sobjects/ObjectPermissions', {
    method: 'POST',
    body: JSON.stringify({
      ParentId: permSetId,
      SobjectType: object,
      PermissionsRead: true,
      PermissionsCreate: true,
      PermissionsEdit: true,
      PermissionsDelete: true,
      PermissionsViewAllRecords: true,
      PermissionsModifyAllRecords: true,
    }),
  });
}

async function assign(permSetId: string, userId: string) {
  const rows = await sf.query(
    `SELECT Id FROM PermissionSetAssignment WHERE PermissionSetId = '${permSetId}' AND AssigneeId = '${userId}'`,
  );
  if (rows[0]) return;
  await sf.api('/sobjects/PermissionSetAssignment', {
    method: 'POST',
    body: JSON.stringify({ PermissionSetId: permSetId, AssigneeId: userId }),
  });
  console.log('  + assigned permission set to the integration user');
}

async function main() {
  console.log('1. External id fields');
  for (const object of ['Account', 'Lead', 'Opportunity']) await createField(object, SUGAR_ID_FIELD, sugarIdMetadata);

  console.log('2. Deal_Review__c custom object');
  if (await objectExists('Deal_Review__c')) {
    console.log('  = Deal_Review__c already exists');
  } else {
    // Element order follows the Metadata API WSDL
    await sf.createMetadata(
      'CustomObject',
      `<met:fullName>Deal_Review__c</met:fullName>
       <met:deploymentStatus>Deployed</met:deploymentStatus>
       <met:description>Discount and risk review for an opportunity. Synced with the SugarCRM Deal Reviews module.</met:description>
       <met:enableActivities>true</met:enableActivities>
       <met:enableReports>true</met:enableReports>
       <met:label>Deal Review</met:label>
       <met:nameField><met:label>Deal Review Name</met:label><met:type>Text</met:type></met:nameField>
       <met:pluralLabel>Deal Reviews</met:pluralLabel>
       <met:sharingModel>ReadWrite</met:sharingModel>`,
    );
    console.log('  + created Deal_Review__c');
  }
  for (const [field, metadata] of Object.entries(dealReviewFields)) await createField('Deal_Review__c', field, metadata);

  console.log('3. Tab so Deal Reviews show up in the Salesforce UI');
  try {
    const tabs = await toolingQuery("SELECT Id FROM CustomTab WHERE DeveloperName = 'Deal_Review'");
    if (tabs.length === 0) {
      await sf.createMetadata(
        'CustomTab',
        '<met:fullName>Deal_Review__c</met:fullName><met:customObject>true</met:customObject><met:motif>Custom18: Form</met:motif>',
      );
      console.log('  + created Deal Reviews tab');
    } else console.log('  = tab already exists');
  } catch (err) {
    console.log(`  ! could not create tab (optional): ${(err as Error).message}`);
  }

  console.log('4. Permissions');
  const permSetId = await ensurePermissionSet();
  for (const object of ['Account', 'Lead', 'Opportunity']) await grantField(permSetId, object, SUGAR_ID_FIELD);
  await grantObject(permSetId, 'Deal_Review__c');
  for (const field of Object.keys(dealReviewFields)) await grantField(permSetId, 'Deal_Review__c', field);
  try {
    const tabRows = await sf.query(`SELECT Id FROM PermissionSetTabSetting WHERE ParentId = '${permSetId}' AND Name = 'Deal_Review__c'`);
    if (!tabRows[0]) {
      await sf.api('/sobjects/PermissionSetTabSetting', {
        method: 'POST',
        body: JSON.stringify({ ParentId: permSetId, Name: 'Deal_Review__c', Visibility: 'DefaultOn' }),
      });
    }
  } catch (err) {
    console.log(`  ! tab visibility not set (optional): ${(err as Error).message}`);
  }
  await assign(permSetId, await sf.userId());

  console.log('\nSalesforce setup complete.');
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
