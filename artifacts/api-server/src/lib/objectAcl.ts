import {
  CopyObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

import { getS3Client } from './storageConfig';

/**
 * Neutral descriptor of an object in S3-compatible storage.
 * Replaces the provider-specific GCS `File` type throughout the codebase.
 */
export interface StorageObject {
  bucket: string;
  key: string;
}

/**
 * S3 user-metadata key under which the ACL policy JSON is stored.
 * (Sent/received as the `x-amz-meta-acl-policy` header; S3 metadata keys
 * must be valid header tokens, so no colons.)
 */
const ACL_POLICY_METADATA_KEY = 'acl-policy';

// Can be flexibly defined according to the use case.
//
// Examples:
// - USER_LIST: the users from a list stored in the database;
// - EMAIL_DOMAIN: the users whose email is in a specific domain;
// - GROUP_MEMBER: the users who are members of a specific group;
// - SUBSCRIBER: the users who are subscribers of a specific service / content
//   creator.
export enum ObjectAccessGroupType {}

export interface ObjectAccessGroup {
  type: ObjectAccessGroupType;
  // The logic id that identifies qualified group members. Format depends on the
  // ObjectAccessGroupType — e.g. a user-list DB id, an email domain, a group id.
  id: string;
}

export enum ObjectPermission {
  READ = 'read',
  WRITE = 'write',
}

export interface ObjectAclRule {
  group: ObjectAccessGroup;
  permission: ObjectPermission;
}

// Stored as S3 object user metadata under "acl-policy" (JSON string).
export interface ObjectAclPolicy {
  owner: string;
  visibility: 'public' | 'private';
  aclRules?: Array<ObjectAclRule>;
}

function isPermissionAllowed(
  requested: ObjectPermission,
  granted: ObjectPermission,
): boolean {
  if (requested === ObjectPermission.READ) {
    return [ObjectPermission.READ, ObjectPermission.WRITE].includes(granted);
  }
  return granted === ObjectPermission.WRITE;
}

abstract class BaseObjectAccessGroup implements ObjectAccessGroup {
  constructor(
    public readonly type: ObjectAccessGroupType,
    public readonly id: string,
  ) {}

  public abstract hasMember(userId: string): Promise<boolean>;
}

function createObjectAccessGroup(
  group: ObjectAccessGroup,
): BaseObjectAccessGroup {
  switch (group.type) {
    // Implement per access group type, e.g.:
    // case "USER_LIST":
    //   return new UserListAccessGroup(group.id);
    default:
      throw new Error(`Unknown access group type: ${group.type}`);
  }
}

/**
 * Sets the ACL policy on an existing object.
 *
 * S3 user metadata is immutable after upload, so this performs a
 * self-copy with MetadataDirective: REPLACE. The object's Content-Type is
 * preserved explicitly (REPLACE would otherwise reset it).
 */
export async function setObjectAclPolicy(
  storageObject: StorageObject,
  aclPolicy: ObjectAclPolicy,
): Promise<void> {
  const s3 = getS3Client();

  let contentType: string | undefined;
  let existingMetadata: Record<string, string> | undefined;
  try {
    const head = await s3.send(
      new HeadObjectCommand({
        Bucket: storageObject.bucket,
        Key: storageObject.key,
      }),
    );
    contentType = head.ContentType;
    existingMetadata = head.Metadata;
  } catch {
    throw new Error(`Object not found: ${storageObject.key}`);
  }

  await s3.send(
    new CopyObjectCommand({
      Bucket: storageObject.bucket,
      Key: storageObject.key,
      CopySource: encodeURIComponent(
        `${storageObject.bucket}/${storageObject.key}`,
      ),
      MetadataDirective: 'REPLACE',
      ContentType: contentType,
      Metadata: {
        ...existingMetadata,
        [ACL_POLICY_METADATA_KEY]: JSON.stringify(aclPolicy),
      },
    }),
  );
}

export async function getObjectAclPolicy(
  storageObject: StorageObject,
): Promise<ObjectAclPolicy | null> {
  const s3 = getS3Client();
  const head = await s3.send(
    new HeadObjectCommand({
      Bucket: storageObject.bucket,
      Key: storageObject.key,
    }),
  );
  const aclPolicy = head.Metadata?.[ACL_POLICY_METADATA_KEY];
  if (!aclPolicy) {
    return null;
  }
  return JSON.parse(aclPolicy);
}

/** Parses an ACL policy from already-fetched S3 user metadata (no extra call). */
export function parseAclPolicyFromMetadata(
  metadata: Record<string, string> | undefined,
): ObjectAclPolicy | null {
  const raw = metadata?.[ACL_POLICY_METADATA_KEY];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function canAccessObject({
  userId,
  objectFile,
  requestedPermission,
}: {
  userId?: string;
  objectFile: StorageObject;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  const aclPolicy = await getObjectAclPolicy(objectFile);
  if (!aclPolicy) {
    return false;
  }

  if (
    aclPolicy.visibility === 'public' &&
    requestedPermission === ObjectPermission.READ
  ) {
    return true;
  }

  if (!userId) {
    return false;
  }

  if (aclPolicy.owner === userId) {
    return true;
  }

  for (const rule of aclPolicy.aclRules || []) {
    const accessGroup = createObjectAccessGroup(rule.group);
    if (
      (await accessGroup.hasMember(userId)) &&
      isPermissionAllowed(requestedPermission, rule.permission)
    ) {
      return true;
    }
  }

  return false;
}
