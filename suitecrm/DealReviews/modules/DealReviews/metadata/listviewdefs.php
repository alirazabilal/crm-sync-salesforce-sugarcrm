<?php
$listViewDefs['DealReviews'] = array(
    'NAME' => array('width' => '30', 'label' => 'LBL_NAME', 'default' => true, 'link' => true),
    'OPPORTUNITY_NAME' => array(
        'width' => '25',
        'label' => 'LBL_OPPORTUNITY',
        'default' => true,
        'id' => 'OPPORTUNITY_ID',
        'module' => 'Opportunities',
        'link' => true,
        'related_fields' => array('opportunity_id'),
    ),
    'REVIEW_STATUS' => array('width' => '12', 'label' => 'LBL_REVIEW_STATUS', 'default' => true),
    'RISK_LEVEL' => array('width' => '10', 'label' => 'LBL_RISK_LEVEL', 'default' => true),
    'DISCOUNT_PERCENT' => array('width' => '10', 'label' => 'LBL_DISCOUNT_PERCENT', 'default' => true),
    'ASSIGNED_USER_NAME' => array('width' => '10', 'label' => 'LBL_ASSIGNED_TO_NAME', 'default' => true, 'module' => 'Employees', 'id' => 'ASSIGNED_USER_ID'),
    'DATE_MODIFIED' => array('width' => '10', 'label' => 'LBL_DATE_MODIFIED', 'default' => true),
);
