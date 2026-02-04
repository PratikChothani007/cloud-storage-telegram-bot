import { config } from '../config/index.js';
import FormData from 'form-data';
import axios from 'axios';

interface CreateUserPayload {
  telegramId: string;
  name?: string | undefined;
  phoneNumber?: string | undefined;
}

interface UserResponse {
  id: string;
  telegramId: string;
  phoneNumber: string | null;
  name: string;
  profilePic: string | null;
  isPhoneVerified: boolean;
  createdAt: string;
}

interface CreateUserResponse {
  status: string;
  message: string;
  data: {
    user: UserResponse;
    token: string;
    isNewUser: boolean;
  };
}

interface UploadFileResponse {
  status: string;
  message: string;
  data: {
    fsObjectId: string;
    filename: string;
    size: number;
    sourceType: string;
  };
}

interface GenerateShareLinkPayload {
  telegramId: string;
  fsObjectId: string;
}

interface UpdatePhonePayload {
  telegramId: string;
  phoneNumber: string;
}

interface UpdatePhoneResponse {
  status: string;
  message: string;
  data: {
    user: {
      id: string;
      telegramId: string;
      phoneNumber: string;
      name: string;
      isPhoneVerified: boolean;
    };
  };
}

interface SharedFile {
  fsObjectId: string;
  filename: string;
  size: number;
  sourceType: string;
  createdAt: string;
  shareCreatedAt: string;
}

interface ListSharedFilesResponse {
  status: string;
  message: string;
  data: {
    files: SharedFile[];
  };
}

interface DeleteShareLinkPayload {
  telegramId: string;
  fsObjectId: string;
}

interface DeleteShareLinkResponse {
  status: string;
  message: string;
  data: {
    fsObjectId: string;
    filename: string;
  };
}

interface LinkWithViews {
  fsObjectId: string;
  filename: string;
  size: number;
  sourceType: string;
  viewCount: number;
  shareableLink: string;
  createdAt: string;
  shareCreatedAt: string;
  expiresAt: string | null;
}

interface GetLinksWithViewsPayload {
  telegramId: string;
  page?: number | undefined;
  limit?: number | undefined;
}

interface GetLinksWithViewsResponse {
  status: string;
  message: string;
  data: {
    links: LinkWithViews[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}

interface DeleteAccountResponse {
  status: string;
  message: string;
  data: {
    deleted: boolean;
  };
}

interface GetUploadUrlPayload {
  telegramId: string;
  filename: string;
  contentType: string;
  fileSize: number;
}

interface GetUploadUrlResponse {
  status: string;
  message: string;
  data: {
    fsObjectId: string;
    uploadUrl: string;
    s3Key: string;
  };
}

interface CompleteUploadPayload {
  telegramId: string;
  fsObjectId: string;
}

interface CompleteUploadResponse {
  status: string;
  message: string;
  data: {
    fsObjectId: string;
    filename: string;
    size: number;
    sourceType: string;
    shareableLink: string;
  };
}

interface GenerateShareLinkResponse {
  status: string;
  message: string;
  data: {
    shareableLink: string;
    filename: string;
    fileSize: number;
    expiresAt: string | null;
  };
}

interface ApiErrorResponse {
  status: string;
  message: string;
  error?: string;
}

export class CloudStorageApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public response?: ApiErrorResponse
  ) {
    super(message);
    this.name = 'CloudStorageApiError';
  }
}

class CloudStorageApi {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = config.cloudStorageApiUrl;
    this.apiKey = config.botApiKey;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': this.apiKey,
      ...((options.headers as Record<string, string>) || {}),
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    const data = await response.json() as T | ApiErrorResponse;

    if (!response.ok) {
      const errorData = data as ApiErrorResponse;
      throw new CloudStorageApiError(
        errorData.message || errorData.error || 'API request failed',
        response.status,
        errorData
      );
    }

    return data as T;
  }

  async createUser(payload: CreateUserPayload): Promise<CreateUserResponse> {
    return this.request<CreateUserResponse>('/api/v1/auth/bot/create-user', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async uploadFile(
    telegramId: string,
    filename: string,
    contentType: string,
    fileBuffer: Buffer
  ): Promise<UploadFileResponse> {
    const url = `${this.baseUrl}/api/v1/auth/bot/upload-file`;

    // Create form data using form-data package
    const formData = new FormData();
    formData.append('file', fileBuffer, {
      filename: filename,
      contentType: contentType,
    });

    try {
      const response = await axios.post<UploadFileResponse>(url, formData, {
        headers: {
          ...formData.getHeaders(),
          'X-API-Key': this.apiKey,
          'X-Telegram-Id': telegramId,
          'X-Filename': encodeURIComponent(filename),
          'X-Content-Type': contentType,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      return response.data;
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response) {
        const errorData = error.response.data as ApiErrorResponse;
        throw new CloudStorageApiError(
          errorData.message || errorData.error || 'Upload failed',
          error.response.status,
          errorData
        );
      }
      throw error;
    }
  }

  async generateShareLink(payload: GenerateShareLinkPayload): Promise<GenerateShareLinkResponse> {
    return this.request<GenerateShareLinkResponse>('/api/v1/auth/bot/generate-share-link', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updatePhone(payload: UpdatePhonePayload): Promise<UpdatePhoneResponse> {
    return this.request<UpdatePhoneResponse>('/api/v1/auth/bot/update-phone', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async listSharedFiles(telegramId: string): Promise<ListSharedFilesResponse> {
    return this.request<ListSharedFilesResponse>('/api/v1/auth/bot/list-shared-files', {
      method: 'POST',
      body: JSON.stringify({ telegramId }),
    });
  }

  async deleteShareLink(payload: DeleteShareLinkPayload): Promise<DeleteShareLinkResponse> {
    return this.request<DeleteShareLinkResponse>('/api/v1/auth/bot/delete-share-link', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getLinksWithViews(payload: GetLinksWithViewsPayload): Promise<GetLinksWithViewsResponse> {
    return this.request<GetLinksWithViewsResponse>('/api/v1/auth/bot/links-with-views', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async deleteAccount(telegramId: string): Promise<DeleteAccountResponse> {
    return this.request<DeleteAccountResponse>('/api/v1/auth/bot/delete-account', {
      method: 'POST',
      body: JSON.stringify({ telegramId }),
    });
  }

  async getUploadUrl(payload: GetUploadUrlPayload): Promise<GetUploadUrlResponse> {
    return this.request<GetUploadUrlResponse>('/api/v1/auth/bot/get-upload-url', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async completeUpload(payload: CompleteUploadPayload): Promise<CompleteUploadResponse> {
    return this.request<CompleteUploadResponse>('/api/v1/auth/bot/complete-upload', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async uploadToS3(uploadUrl: string, fileBuffer: Buffer, contentType: string): Promise<void> {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body: new Uint8Array(fileBuffer),
    });

    if (!response.ok) {
      throw new CloudStorageApiError(
        'Failed to upload to S3',
        response.status
      );
    }
  }
}

export const cloudStorageApi = new CloudStorageApi();
