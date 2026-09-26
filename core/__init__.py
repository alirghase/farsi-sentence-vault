"""Shared Farsi Vault logic.

Used by the content pipeline in tools/. Also imported by backend/, which is
parked and not deployed — nothing in web/ or tools/ references it at run time.
Keeping prompts, taxonomy and validation in one place is what stops the
generator and the app from drifting apart.
"""
