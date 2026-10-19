<?php
$dictionary['DealReviews'] = array(
    'table' => 'deal_reviews',
    'audited' => true,
    'unified_search' => true,
    'duplicate_merge' => true,
    'optimistic_locking' => true,
    'fields' => array(
        'opportunity_id' => array(
            'name' => 'opportunity_id',
            'vname' => 'LBL_OPPORTUNITY_ID',
            'type' => 'id',
            'reportable' => true,
            'audited' => true,
        ),
        'opportunity_name' => array(
            'name' => 'opportunity_name',
            'vname' => 'LBL_OPPORTUNITY',
            'type' => 'relate',
            'source' => 'non-db',
            'id_name' => 'opportunity_id',
            'ext2' => 'Opportunities',
            'module' => 'Opportunities',
            'rname' => 'name',
            'quicksearch' => 'enabled',
            'studio' => 'visible',
        ),
        'review_status' => array(
            'name' => 'review_status',
            'vname' => 'LBL_REVIEW_STATUS',
            'type' => 'enum',
            'options' => 'deal_review_status_list',
            'len' => 30,
            'default' => 'Pending',
            'audited' => true,
            'massupdate' => true,
        ),
        'risk_level' => array(
            'name' => 'risk_level',
            'vname' => 'LBL_RISK_LEVEL',
            'type' => 'enum',
            'options' => 'deal_review_risk_list',
            'len' => 20,
            'default' => 'Medium',
            'audited' => true,
            'massupdate' => true,
        ),
        'discount_percent' => array(
            'name' => 'discount_percent',
            'vname' => 'LBL_DISCOUNT_PERCENT',
            'type' => 'decimal',
            'len' => '5',
            'precision' => '2',
            'audited' => true,
        ),
        'reviewer_notes' => array(
            'name' => 'reviewer_notes',
            'vname' => 'LBL_REVIEWER_NOTES',
            'type' => 'text',
            'rows' => 5,
            'cols' => 60,
        ),
    ),
    'indices' => array(
        array('name' => 'idx_deal_reviews_opp', 'type' => 'index', 'fields' => array('opportunity_id')),
    ),
    'relationships' => array(),
);

if (!class_exists('VardefManager')) {
    require_once 'include/SugarObjects/VardefManager.php';
}
VardefManager::createVardef('DealReviews', 'DealReviews', array('basic', 'assignable', 'security_groups'));
