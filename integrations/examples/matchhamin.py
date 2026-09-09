"""نمونه اتصال bot.py؛ این فایل روی سرور نصب نشده است."""
import os
from integrations.python.crm_client import CrmClient

crm = CrmClient(os.getenv("CRM_URL", ""), "matchhamin", os.getenv("CRM_API_KEY", ""))

# فقط پس از کامل‌شدن هر تلاش، بدون حذف یا تغییر رکورد قبلی CRM:
crm.send(
    event_id=f"match-profile-{user_id}-{attempt_number}",
    event_type="matchmaking.profile.completed",
    payload={
        "profileId": str(user_id),
        "attemptNumber": attempt_number,
        "profile": profile_data,
        "answers": answers,
        "traits": traits,
        "archetype": archetype,
        "consent": consent,
    },
)

