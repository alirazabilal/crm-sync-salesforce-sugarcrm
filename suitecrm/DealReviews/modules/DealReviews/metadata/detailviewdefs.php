<?php
$viewdefs['DealReviews']['DetailView'] = array(
    'templateMeta' => array(
        'form' => array('buttons' => array('EDIT', 'DUPLICATE', 'DELETE')),
        'maxColumns' => '2',
        'widths' => array(array('label' => '10', 'field' => '30'), array('label' => '10', 'field' => '30')),
    ),
    'panels' => array(
        'lbl_default_panel' => array(
            array('name', 'opportunity_name'),
            array('review_status', 'risk_level'),
            array('discount_percent', 'assigned_user_name'),
            array('reviewer_notes'),
            array('date_entered', 'date_modified'),
        ),
    ),
);
