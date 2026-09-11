"""
WoL (Wake-on-LAN) service.

Generates and broadcasts standard Magic Packets to wake endpoints by MAC address.
Isolates WoL implementation so that office-side gateways can be added later without
modifying this service layer.

MAC address must be validated and normalized before calling send_wol().
"""

import re
import socket
from django.conf import settings


def normalize_mac(mac_str: str) -> str:
    """
    Normalize MAC address to colon-separated format: AA:BB:CC:DD:EE:FF
    
    Accepts:
      AA:BB:CC:DD:EE:FF
      AA-BB-CC-DD-EE-FF
      AABBCCDDEEFF
      aa:bb:cc:dd:ee:ff (lowercase)
    
    Returns: Uppercase colon-separated format or raises ValueError if invalid.
    """
    if not mac_str:
        raise ValueError("MAC address cannot be empty")
    
    # Remove common separators
    mac_clean = mac_str.upper().replace('-', ':').replace('.', ':').replace(' ', '')
    
    # Remove any remaining colons to check raw hex
    mac_hex = mac_clean.replace(':', '')
    
    # Must be exactly 12 hex characters
    if not re.match(r'^[0-9A-F]{12}$', mac_hex):
        raise ValueError(f"Invalid MAC address format: {mac_str}")
    
    # Reformat as colon-separated
    normalized = ':'.join(mac_hex[i:i+2] for i in range(0, 12, 2))
    return normalized


def generate_magic_packet(mac_address: str) -> bytes:
    """
    Generate a standard Wake-on-LAN magic packet.
    
    Magic packet structure:
      - 6 bytes of 0xFF (preamble)
      - 16 repetitions of the target MAC address (6 bytes each)
    
    Total: 6 + (16 * 6) = 102 bytes
    """
    # Normalize MAC
    mac = normalize_mac(mac_address)
    
    # Convert MAC string to bytes
    mac_bytes = bytes.fromhex(mac.replace(':', ''))
    
    # Build magic packet: 0xFF preamble + 16x MAC
    preamble = b'\xff' * 6
    payload = preamble + (mac_bytes * 16)
    
    return payload


def send_wol(mac_address: str) -> dict:
    """
    Send a Wake-on-LAN magic packet to wake the endpoint.
    
    Args:
        mac_address: MAC address string (any common format)
    
    Returns:
        {
            "success": bool,
            "message": str,
            "mac_normalized": str (if success),
            "error": str (if failed)
        }
    
    This function:
      - Validates and normalizes the MAC address
      - Generates the magic packet
      - Broadcasts it on the local network (255.255.255.255:9 by default)
    
    It does NOT:
      - Verify the PC actually powered on (use heartbeat for that)
      - Support office-side gateways yet (infrastructure for later)
    """
    try:
        # Normalize and validate MAC
        mac_normalized = normalize_mac(mac_address)
    except ValueError as e:
        return {
            "success": False,
            "error": str(e),
            "message": f"Invalid MAC address: {e}",
        }
    
    try:
        # Generate magic packet
        packet = generate_magic_packet(mac_normalized)
        
        # Send via UDP broadcast
        broadcast_ip = settings.WOL_BROADCAST_IP
        broadcast_port = settings.WOL_PORT
        
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        
        sock.sendto(packet, (broadcast_ip, broadcast_port))
        sock.close()
        
        return {
            "success": True,
            "message": f"Wake-on-LAN packet sent to {mac_normalized}",
            "mac_normalized": mac_normalized,
        }
    
    except socket.error as e:
        return {
            "success": False,
            "error": str(e),
            "message": f"Failed to send magic packet: {e}",
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "message": f"Unexpected error sending WoL: {e}",
        }
