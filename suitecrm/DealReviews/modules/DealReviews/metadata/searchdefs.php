<?php
$searchdefs['DealReviews'] = array(
    'templateMeta' => array('maxColumns' => '3', 'widths' => array('label' => '10', 'field' => '30')),
    'layout' => array(
        'basic_search' => array('name', 'review_status', array('name' => 'current_user_only', 'label' => 'LBL_CURRENT_USER_FILTER', 'type' => 'bool')),
        'advanced_search' => array('name', 'opportunity_name', 'review_status', 'risk_level', 'assigned_user_name'),
    ),
);
