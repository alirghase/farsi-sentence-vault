"""Shared Farsi Vault logic.

Used by BOTH the one-off seed generator (tools/) and the Cloud Run service
(backend/). Keeping prompts, taxonomy, and validation in one place is what stops
the generator and the live service from drifting apart.
"""
