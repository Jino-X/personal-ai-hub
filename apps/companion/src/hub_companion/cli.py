"""Command-line interface: `hub-companion pair|run|status|doctor|unpair`."""

from __future__ import annotations

import argparse
import asyncio
import logging
import signal
import sys

from hub_companion import __version__, credentials
from hub_companion.auth import AuthError, DeviceRevokedError, TokenManager, pair
from hub_companion.config import Settings, ensure_secure_server, get_settings
from hub_companion.connection import CompanionConnection
from hub_companion.ollama import OllamaClient, OllamaError

RECOMMENDED_MODELS = {
    "qwen3:8b": "chat (default)",
    "qwen3-embedding:0.6b": "embeddings (default, 1024-dim)",
}


def _setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("websockets").setLevel(logging.WARNING)


def cmd_pair(settings: Settings, args: argparse.Namespace) -> int:
    try:
        server = ensure_secure_server(args.server, args.insecure or settings.allow_insecure)
    except ValueError as exc:
        print(f"✗ {exc}", file=sys.stderr)
        return 2
    existing = credentials.load(settings.credentials_path)
    if existing and not args.force:
        print(f"This Mac is already paired as '{existing.device_name}' ({existing.device_id[:8]}). Use --force to re-pair.")
        return 1
    name = args.name or settings.device_name
    try:
        creds = asyncio.run(pair(settings, server, args.code, name))
    except AuthError as exc:
        print(f"✗ {exc}", file=sys.stderr)
        return 1
    print(f"✓ Paired as '{creds.device_name}' (device {creds.device_id[:8]}).")
    print(f"  Credentials stored in {settings.credentials_path} (readable only by you).")
    print("  Start the companion with:  hub-companion run")
    return 0


async def _run(settings: Settings) -> int:
    creds = credentials.load(settings.credentials_path)
    if not creds:
        logging.error("This device is not paired. Generate a code in Settings → AI, then run `hub-companion pair`.")
        return 2
    ollama = OllamaClient(settings.ollama_url)
    try:
        try:
            version = await ollama.version()
            logging.info("Ollama %s reachable at %s", version, settings.ollama_url)
        except OllamaError:
            logging.warning("Ollama is not reachable at %s yet — jobs will fail until it starts", settings.ollama_url)

        connection = CompanionConnection(settings, TokenManager(settings, creds), ollama)
        await connection.run_forever()
        return 0
    except DeviceRevokedError as exc:
        logging.error("Device credentials are no longer valid: %s", exc)
        logging.error("Pair again with `hub-companion pair --force --server ... --code ...`.")
        return 3
    finally:
        await ollama.aclose()


def cmd_run(settings: Settings, _args: argparse.Namespace) -> int:
    logging.info("hub-companion %s starting", __version__)
    loop = asyncio.new_event_loop()
    main_task = loop.create_task(_run(settings))
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, main_task.cancel)
    try:
        return loop.run_until_complete(main_task)
    except asyncio.CancelledError:
        logging.info("Stopped")
        return 0
    finally:
        loop.close()


async def _doctor(settings: Settings) -> int:
    ollama = OllamaClient(settings.ollama_url)
    ok = True
    try:
        try:
            version = await ollama.version()
            models = {m.get("name", "") for m in await ollama.tags()}
            print(f"✓ Ollama {version} at {settings.ollama_url} ({len(models)} models installed)")
        except OllamaError:
            print(f"✗ Ollama is not reachable at {settings.ollama_url}. Install it from https://ollama.com and run `ollama serve`.")
            return 1
        for model, purpose in RECOMMENDED_MODELS.items():
            present = any(n == model or n.startswith(f"{model}-") for n in models)
            ok &= present
            print(f"{'✓' if present else '✗'} {model:<24} {purpose}{'' if present else f'  →  ollama pull {model}'}")
        if settings.allowed_models:
            print(f"• Model allow-list active: {', '.join(settings.allowed_models)}")
        creds = credentials.load(settings.credentials_path)
        print(f"{'✓' if creds else '✗'} Paired: {f'{creds.device_name} → {creds.server_url}' if creds else 'no (run hub-companion pair)'}")
        return 0 if ok and creds else 1
    finally:
        await ollama.aclose()


def cmd_doctor(settings: Settings, _args: argparse.Namespace) -> int:
    return asyncio.run(_doctor(settings))


def cmd_status(settings: Settings, _args: argparse.Namespace) -> int:
    creds = credentials.load(settings.credentials_path)
    if not creds:
        print("Not paired.")
        return 1
    print(f"Device:   {creds.device_name} ({creds.device_id})")
    print(f"Server:   {creds.server_url}")
    print(f"Paired:   {creds.paired_at}")
    print(f"Ollama:   {settings.ollama_url}")
    return 0


def cmd_unpair(settings: Settings, _args: argparse.Namespace) -> int:
    if credentials.delete(settings.credentials_path):
        print("✓ Local credentials removed. Also revoke the device in Settings → AI to invalidate it server-side.")
        return 0
    print("Not paired.")
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="hub-companion", description="Local AI companion for Personal AI Hub")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = parser.add_subparsers(dest="command")

    p_pair = sub.add_parser("pair", help="Pair this Mac with your Personal AI Hub account")
    p_pair.add_argument("--server", required=True, help="API URL, e.g. https://api.example.com")
    p_pair.add_argument("--code", required=True, help="Pairing code from Settings → AI")
    p_pair.add_argument("--name", help="Device name shown in the web app")
    p_pair.add_argument("--force", action="store_true", help="Replace existing pairing")
    p_pair.add_argument("--insecure", action="store_true", help="Allow http:// for non-local servers (development only)")

    sub.add_parser("run", help="Connect and serve inference jobs (default)")
    sub.add_parser("status", help="Show pairing details")
    sub.add_parser("doctor", help="Check Ollama, recommended models and pairing")
    sub.add_parser("unpair", help="Delete local credentials")

    args = parser.parse_args(argv)
    settings = get_settings()
    _setup_logging(settings.log_level)

    handlers = {"pair": cmd_pair, "run": cmd_run, "status": cmd_status, "doctor": cmd_doctor, "unpair": cmd_unpair}
    return handlers[args.command or "run"](settings, args)


if __name__ == "__main__":
    raise SystemExit(main())
