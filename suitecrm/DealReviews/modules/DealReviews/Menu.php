<?php
if (!defined('sugarEntry') || !sugarEntry) {
    die('Not A Valid Entry Point');
}

global $mod_strings;
$module_menu = array();
if (ACLController::checkAccess('DealReviews', 'edit', true)) {
    $module_menu[] = array('index.php?module=DealReviews&action=EditView&return_module=DealReviews&return_action=DetailView', $mod_strings['LNK_NEW_RECORD'], 'Add', 'DealReviews');
}
if (ACLController::checkAccess('DealReviews', 'list', true)) {
    $module_menu[] = array('index.php?module=DealReviews&action=index&return_module=DealReviews&return_action=DetailView', $mod_strings['LNK_LIST'], 'View', 'DealReviews');
}
