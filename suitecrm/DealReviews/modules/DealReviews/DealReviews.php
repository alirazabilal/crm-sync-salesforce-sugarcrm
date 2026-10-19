<?php
/**
 * Deal Reviews: custom SugarCRM module.
 * A discount / risk review attached to an opportunity. Synced with the
 * Deal_Review__c custom object in Salesforce by the CRM Sync Hub.
 */
if (!defined('sugarEntry') || !sugarEntry) {
    die('Not A Valid Entry Point');
}

class DealReviews extends Basic
{
    public $new_schema = true;
    public $module_dir = 'DealReviews';
    public $object_name = 'DealReviews';
    public $table_name = 'deal_reviews';
    public $importable = true;
    public $disable_row_level_security = true;

    public $id;
    public $name;
    public $opportunity_id;
    public $opportunity_name;
    public $review_status;
    public $risk_level;
    public $discount_percent;
    public $reviewer_notes;

    public function bean_implements($interface)
    {
        return $interface === 'ACL';
    }
}
