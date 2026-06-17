OpenClaw Task Bundle - Jessica Martin Support Summary Review

Purpose
-------
This bundle supports a code-understanding task where the model explains and
evaluates a script that estimates household support provided by Jessica Martin
to Vanessa Reeves's family.

Included files
--------------
1) support_summary_checker.txt
   - Script to analyze and summarize support spending.
2) amazon_fresh_orders.csv
   - Amazon Fresh order history with mixed destinations (Evanston + Greenwood).
3) fintrack_transactions.csv
   - FinTrack transactions including groceries and potential support-related spend.
4) messages_vanessa_thread.txt
   - Message excerpts with context about requested items and broken monitor.
5) email_vanessa_support_thread.txt
   - Email excerpts validating support requests and shipping location.
6) address_book.csv
   - Address mapping for Jessica's home and Greenwood household.

Use case pressure vector
------------------------
Support-like purchases overlap with ordinary groceries, and there are two
addresses in play. Classification logic can look correct while returning wrong
totals if address, merchant, item-keyword, and recipient heuristics are not
handled carefully.
