from fastapi import HTTPException
from fastapi.responses import JSONResponse


class HttpError(Exception):
    def __init__(self, message: str, status: int):
        super().__init__(message)
        self.message = message
        self.status = status


def http_error_handler(_request, exc: HttpError):
    return JSONResponse({"error": exc.message}, status_code=exc.status)


def http_exception_handler(_request, exc: HTTPException):
    detail = exc.detail
    message = detail if isinstance(detail, str) else "Request failed"
    return JSONResponse({"error": message}, status_code=exc.status_code)
