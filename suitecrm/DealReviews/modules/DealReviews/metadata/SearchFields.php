<?php
$searchFields['DealReviews'] = array(
    'name' => array('query_type' => 'default'),
    'review_status' => array('query_type' => 'default', 'options' => 'deal_review_status_list', 'template_var' => 'STATUS_OPTIONS'),
    'risk_level' => array('query_type' => 'default', 'options' => 'deal_review_risk_list'),
    'current_user_only' => array('query_type' => 'default', 'db_field' => array('assigned_user_id'), 'my_items' => true, 'vname' => 'LBL_CURRENT_USER_FILTER', 'type' => 'bool'),
    'assigned_user_id' => array('query_type' => 'default'),
);
