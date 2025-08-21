from app import app as application

# Gunicorn will look for `application` by default when using `wsgi:application`.
# You can also target `wsgi:app` if you prefer the `app` name.
app = application

