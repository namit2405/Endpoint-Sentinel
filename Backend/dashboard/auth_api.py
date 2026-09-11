"""
Authentication API endpoints for the React frontend.

Endpoints:
  POST /api/auth/login/ — Login with username and password, return token
  POST /api/auth/logout/ — Logout (invalidate session)
  GET  /api/auth/user/ — Get current user info
"""

import json
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods, require_POST
from django.contrib.auth import authenticate
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.authentication import TokenAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response


@csrf_exempt
@require_POST
def login(request):
    """
    POST /api/auth/login/
    
    Authenticate user with username and password.
    
    Request:
      {
        "username": "acme_admin",
        "password": "AcmeSecure@2026",
        "account_type": "company"  # optional: "individual" or "company"
      }
    
    Response:
      {
        "user_id": 1,
        "username": "acme_admin",
        "email": "admin@acmecorp.com",
        "first_name": "John",
        "last_name": "Admin",
        "token": "token_string_here"
      }
    """
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()
    account_type = data.get("account_type", "individual").strip()
    
    if not username or not password:
        return JsonResponse({
            "error": "username and password required"
        }, status=400)

    if account_type not in ("company", "individual"):
      return JsonResponse({
        "error": "Invalid credentials"
      }, status=401)
    
    # Authenticate user
    user = authenticate(username=username, password=password)
    
    if user is None:
        return JsonResponse({
        "error": "Invalid credentials"
        }, status=401)

    company_account = getattr(user, "company_admin", None)
    employee_account = getattr(user, "employee", None)
    individual_account = getattr(user, "individual_account", None)
    has_company_account = bool(company_account or employee_account)
    has_individual_account = bool(individual_account)

    if (account_type == "company" and not has_company_account) or \
       (account_type == "individual" and not has_individual_account):
      return JsonResponse({
        "error": "Invalid credentials"
      }, status=401)
    
    # Get or create token
    token, created = Token.objects.get_or_create(user=user)

    if account_type == "company":
      company = getattr(getattr(user, "company_admin", None), "name", None)
      if not company:
        company = getattr(getattr(user, "employee", None), "company", None)
        company = getattr(company, "name", None)
      account_name = company or user.get_full_name() or user.username
    else:
      individual = getattr(user, "individual_account", None)
      account_name = (
        getattr(individual, "organization_name", "")
        or user.get_full_name()
        or user.username
      )
    
    return JsonResponse({
        "user_id": user.id,
        "username": user.username,
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "account_name": account_name,
        "token": token.key
    })


@api_view(['POST'])
@authentication_classes([TokenAuthentication])
@permission_classes([IsAuthenticated])
def logout(request):
    """
    POST /api/auth/logout/
    
    Logout user by invalidating their token.
    
    Headers:
      Authorization: Token <token>
    
    Response:
      {
        "message": "Logged out successfully"
      }
    """
    # Delete token to logout
    Token.objects.filter(user=request.user).delete()
    
    return Response({"message": "Logged out successfully"})


@api_view(['GET'])
@authentication_classes([TokenAuthentication])
@permission_classes([IsAuthenticated])
def get_user(request):
    """
    GET /api/auth/user/
    
    Get current authenticated user info.
    
    Headers:
      Authorization: Token <token>
    
    Response:
      {
        "user_id": 1,
        "username": "acme_admin",
        "email": "admin@acmecorp.com",
        "first_name": "John",
        "last_name": "Admin",
        "is_staff": false
      }
    """
    user = request.user
    return Response({
        "user_id": user.id,
        "username": user.username,
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "is_staff": user.is_staff
    })
