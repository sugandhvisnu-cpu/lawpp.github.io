#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
@license
Copyright 2026 Lawpp. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0

Official eCourts API Live Sync Engine.
Optimized for live direct gateway execution on restricted cloud sandboxes.
"""

import os
import sys
import json
import time
import datetime
import requests
import firebase_admin
from firebase_admin import credentials, firestore

def get_firestore_client():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    config_paths = [
        os.path.join(base_dir, '../firebase-applet-config.json'),
        os.path.join(base_dir, 'firebase-applet-config.json'),
        './firebase-applet-config.json'
    ]
    
    config_data = {}
    for path in config_paths:
        if os.path.exists(path):
            try:
                with open(path, 'r') as f:
                    config_data = json.load(f)
                break
            except Exception:
                pass

    project_id = config_data.get("projectId") or os.environ.get("GOOGLE_CLOUD_PROJECT")
    database_id = config_data.get("firestoreDatabaseId") or "(default)"

    if not firebase_admin._apps:
        try:
            cred = credentials.ApplicationDefault()
            firebase_admin.initialize_app(cred, {'projectId': project_id})
        except Exception:
            firebase_admin.initialize_app()

    try:
        from google.cloud import firestore as g_firestore
        return g_firestore.Client(project=project_id, database=database_id)
    except Exception:
        return firestore.client()

def run_sync_pipeline():
    print("==================================================================")
    print("       LAWPP: ECOURTS API LIVE SYNC PIPELINE RUNNING               ")
    print("==================================================================")
    
    db = get_firestore_client()
    cases_ref = db.collection('cases')
    docs = list(cases_ref.stream())
    
    print(f"Streaming {len(docs)} case records straight from live collection...")
    
    success_count = 0
    for doc in docs:
        case_data = doc.to_dict()
        cnr_number = case_data.get('id') or doc.id
        
        print(f"\nContacting eCourts Live Endpoint directly for CNR: {cnr_number}")

        try:
            # Query official eCourts live endpoint directly with standard GET requests and authorization key
            response = requests.get(
                f'https://webapi.ecourtsindia.com/api/partner/case/{cnr_number.upper().strip()}', 
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer eci_live_cvr5btg88w6u7r2jzb7wsxy89x3kvmoc'
                },
                timeout=30
            )
            
            if response.status_code == 200:
                raw_payload = response.json()
                data = raw_payload.get('data', {}) or {}
                case_data_inner = data.get('courtCaseData', {}) or data or raw_payload or {}
                
                entity_info = data.get('entityInfo', {}) or {}
                raw_hearing_date = (
                    case_data_inner.get('nextHearingDate') or 
                    case_data_inner.get('next_hearing_date') or 
                    case_data_inner.get('nextDateOfHearing') or 
                    entity_info.get('nextDateOfHearing') or 
                    raw_payload.get('nextHearingDate') or 
                    raw_payload.get('nextDateOfHearing') or 
                    case_data_inner.get('hearing_date')
                )
                if raw_hearing_date and isinstance(raw_hearing_date, str):
                    real_next_hearing_date = raw_hearing_date.split('T')[0]
                else:
                    real_next_hearing_date = str(raw_hearing_date) if raw_hearing_date else 'Not Scheduled'

                real_case_stage = case_data_inner.get('caseStatus') or case_data_inner.get('case_stage') or case_data_inner.get('caseTypeSub') or 'Live Status Active'
                real_court_name = case_data_inner.get('courtName') or case_data_inner.get('court_name') or case_data_inner.get('court_complex') or 'District/High Court'
                real_case_title = case_data_inner.get('caseTitle') or case_data_inner.get('case_title') or case_data_inner.get('caseNumber') or case_data_inner.get('title') or 'Live Litigation Matter'
                real_petitioner = case_data_inner.get('petitioner') or case_data_inner.get('petitionerName') or case_data_inner.get('petName') or case_data_inner.get('pet_name') or case_data_inner.get('petitioner_name') or case_data_inner.get('pet_details') or 'Not Available'

                doc_ref = cases_ref.document(cnr_number)
                doc_ref.update({
                    'next_hearing_date': real_next_hearing_date,
                    'case_stage': real_case_stage,
                    'court_name': real_court_name,
                    'case_title': real_case_title,
                    'petitioner': real_petitioner,
                    'last_updated': datetime.datetime.utcnow().isoformat()
                })
                print(f"-> SUCCESS: Database updated with absolute production data streams!")
                success_count += 1
            else:
                print(f"-> Gateway connection returned bad status code: {response.status_code}")
        except Exception as e:
            print(f"-> Connection error on live bridge: {e}", sys.stderr)

    print(f"\nPipeline processing complete. Live sync applied to {success_count} case paths.")

if __name__ == "__main__":
    run_sync_pipeline()
