#!/bin/bash
# Licensing API Test Script
# Tests all licensing endpoints with sample data
# Make sure the backend is running on http://localhost:8001

BASE_URL="http://localhost:8001"
COMPANY_LICENSE="ES-2LXG-496B-35TG"
INDIVIDUAL_LICENSE="ES-4HYT-ABSJ-LCYA"

echo "═══════════════════════════════════════════════════════════"
echo "Endpoint Sentinel Licensing API Test"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Test 1: Validate Company License
echo "TEST 1: Validate Company License"
echo "─────────────────────────────────"
curl -s -X POST "$BASE_URL/api/licenses/validate/" \
  -H "Content-Type: application/json" \
  -d "{\"license_key\": \"$COMPANY_LICENSE\"}" | python3 -m json.tool
echo ""
echo ""

# Test 2: Get Company License Status (Before Activation)
echo "TEST 2: Get Company License Status (Before Activation)"
echo "────────────────────────────────────────────────────"
curl -s "$BASE_URL/api/licenses/status/?license_key=$COMPANY_LICENSE" | python3 -m json.tool
echo ""
echo ""

# Test 3: Activate First Device
echo "TEST 3: Activate First Device (AA:BB:CC:DD:EE:FF)"
echo "─────────────────────────────────────────────────"
curl -s -X POST "$BASE_URL/api/licenses/activate-device/" \
  -H "Content-Type: application/json" \
  -d "{
    \"license_key\": \"$COMPANY_LICENSE\",
    \"mac_address\": \"AA:BB:CC:DD:EE:FF\",
    \"hostname\": \"DESKTOP-001\"
  }" | python3 -m json.tool
echo ""
echo ""

# Test 4: Activate Second Device
echo "TEST 4: Activate Second Device (11:22:33:44:55:66)"
echo "──────────────────────────────────────────────────"
curl -s -X POST "$BASE_URL/api/licenses/activate-device/" \
  -H "Content-Type: application/json" \
  -d "{
    \"license_key\": \"$COMPANY_LICENSE\",
    \"mac_address\": \"11:22:33:44:55:66\",
    \"hostname\": \"DESKTOP-002\"
  }" | python3 -m json.tool
echo ""
echo ""

# Test 5: Get Company License Status (After Activation)
echo "TEST 5: Get Company License Status (After Activation)"
echo "────────────────────────────────────────────────────"
curl -s "$BASE_URL/api/licenses/status/?license_key=$COMPANY_LICENSE" | python3 -m json.tool
echo ""
echo ""

# Test 6: Try to Activate Third Device (Should Fail - Limit Exceeded)
echo "TEST 6: Try to Activate Third Device (Should Fail - Limit Exceeded)"
echo "─────────────────────────────────────────────────────────────────"
curl -s -X POST "$BASE_URL/api/licenses/activate-device/" \
  -H "Content-Type: application/json" \
  -d "{
    \"license_key\": \"$COMPANY_LICENSE\",
    \"mac_address\": \"77:88:99:AA:BB:CC\",
    \"hostname\": \"DESKTOP-003\"
  }" | python3 -m json.tool
echo ""
echo ""

# Test 7: Deactivate First Device
echo "TEST 7: Deactivate First Device (AA:BB:CC:DD:EE:FF)"
echo "──────────────────────────────────────────────────"
curl -s -X POST "$BASE_URL/api/licenses/deactivate-device/" \
  -H "Content-Type: application/json" \
  -d "{
    \"license_key\": \"$COMPANY_LICENSE\",
    \"mac_address\": \"AA:BB:CC:DD:EE:FF\"
  }" | python3 -m json.tool
echo ""
echo ""

# Test 8: Now Activate Third Device (Should Succeed)
echo "TEST 8: Now Activate Third Device (Should Succeed)"
echo "──────────────────────────────────────────────────"
curl -s -X POST "$BASE_URL/api/licenses/activate-device/" \
  -H "Content-Type: application/json" \
  -d "{
    \"license_key\": \"$COMPANY_LICENSE\",
    \"mac_address\": \"77:88:99:AA:BB:CC\",
    \"hostname\": \"DESKTOP-003\"
  }" | python3 -m json.tool
echo ""
echo ""

# Test 9: Validate Individual License
echo "TEST 9: Validate Individual License"
echo "───────────────────────────────────"
curl -s -X POST "$BASE_URL/api/licenses/validate/" \
  -H "Content-Type: application/json" \
  -d "{\"license_key\": \"$INDIVIDUAL_LICENSE\"}" | python3 -m json.tool
echo ""
echo ""

# Test 10: Get Final Company License Status
echo "TEST 10: Get Final Company License Status"
echo "──────────────────────────────────────────"
curl -s "$BASE_URL/api/licenses/status/?license_key=$COMPANY_LICENSE" | python3 -m json.tool
echo ""
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "Tests Complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Summary:"
echo "  ✓ Validated licenses"
echo "  ✓ Activated multiple devices"
echo "  ✓ Tested device limit enforcement"
echo "  ✓ Tested deactivation and reactivation"
echo ""
echo "Admin Dashboard:"
echo "  http://localhost:8001/admin/"
echo "  Username: admin"
echo "  Password: admin123"
