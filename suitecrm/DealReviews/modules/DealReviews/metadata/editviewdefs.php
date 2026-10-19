<?php
$viewdefs['DealReviews']['EditView'] = array(
    'templateMeta' => array(
        'maxColumns' => '2',
        'widths' => array(array('label' => '10', 'field' => '30'), array('label' => '10', 'field' => '30')),
    ),
    'panels' => array(
        'lbl_default_panel' => array(
            array('name', 'opportunity_name'),
            array('review_status', 'risk_level'),
            array('discount_percent', 'assigned_user_name'),
            array(array('name' => 'reviewer_notes', 'displayParams' => array('rows' => 5, 'cols' => 80))),
        ),
    ),
);
