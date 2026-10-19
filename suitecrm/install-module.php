<?php
/**
 * Installs the Deal Reviews module after its files are copied in:
 * rebuilds extensions, creates the deal_reviews table, adds ACL actions and shows the tab.
 * Run from the SuiteCRM legacy folder:  php install-module.php
 */
if (!defined('sugarEntry')) {
    define('sugarEntry', true);
}
chdir(__DIR__);
require_once 'include/entryPoint.php';
require_once 'modules/Administration/QuickRepairAndRebuild.php';
require_once 'modules/MySettings/TabController.php';
require_once 'modules/ACLActions/ACLAction.php';

global $current_user;
$current_user = BeanFactory::getBean('Users', '1');

// Quick Repair and Rebuild, executing the SQL needed to create the new table
$repair = new RepairAndClear();
$repair->repairAndClearAll(array('clearAll'), array(translate('LBL_ALL_MODULES')), true, false);

// Make sure the table exists even if repair skipped it
$bean = BeanFactory::newBean('DealReviews');
if ($bean && !$GLOBALS['db']->tableExists('deal_reviews')) {
    $bean->create_tables();
}

ACLAction::addActions('DealReviews', 'module');

$tabs = new TabController();
$system = $tabs->get_system_tabs();
if (!isset($system['DealReviews'])) {
    $system['DealReviews'] = 'DealReviews';
    $tabs->set_system_tabs($system);
}

echo $GLOBALS['db']->tableExists('deal_reviews') ? "Deal Reviews module installed\n" : "ERROR: deal_reviews table missing\n";
