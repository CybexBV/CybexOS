/* cybexos-goa-account: Settings' bridge to GNOME Online Accounts.
 *
 * Settings → Online accounts lists the providers and the accounts itself.
 * Signing in stays GNOME's: this helper opens GOA's own dialog for one
 * provider (add) or one account (reconnect), through libgoa-backend's public
 * API, without GNOME's account list. GOA's code does the browser handoff,
 * the token exchange and the keyring write, exactly as in GNOME's window.
 * Nothing secret reaches the arguments or the output.
 *
 *   cybexos-goa-account list               {"providers":[{"type":…,"name":…}]}
 *   cybexos-goa-account add TYPE           {"result":"added","id":…}
 *   cybexos-goa-account reconnect ID       {"result":"reconnected","id":…}
 *
 * Every command prints one JSON line. Results: added, reconnected (exit 0),
 * failed (1), cancelled (3); bad usage exits 2. A result may carry a
 * "reason" Settings words itself: no-service, no-display, no-providers, gone, managed,
 * unsupported, unknown-provider and response (failures of the helper's own
 * or an answer it will not repeat), or unverified (an added account whose
 * sign-in GOA could not confirm). GOA's other errors arrive as GOA's own,
 * already translated "message".
 *
 * SIGTERM or SIGINT cancels: the helper closes GOA's dialog, and GOA
 * releases its OAuth2 bus name. A cancellation is reported as such unless an
 * account of the requested kind appeared meanwhile, which counts as added.
 */
#define GOA_API_IS_SUBJECT_TO_CHANGE
#define GOA_BACKEND_API_IS_SUBJECT_TO_CHANGE

#include <adwaita.h>
#include <fcntl.h>
#include <glib-unix.h>
#include <goa/goa.h>
#include <goabackend/goabackend.h>
#include <locale.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

/* The dialog has no parent window, so libadwaita gives it a plain window of
 * its own and GTK names it after the program: this is the Wayland app id
 * Hyprland's window rule and the tests see. */
#define APP_ID "cybexos-online-accounts"

enum { EXIT_DONE = 0, EXIT_FAILED = 1, EXIT_USAGE = 2, EXIT_CANCELLED = 3 };

/* Providers whose GOA backend implements reconnecting (refresh_account);
 * Fedora's does not, so its accounts never reach that call. */
static const char *const reconnectable[] = {
  "google", "ms_graph", "owncloud", "exchange", "imap_smtp", "webdav", "kerberos", NULL
};

/* Where the one result line goes. While a dialog is open GOA starts the
 * browser, which would inherit the standard streams: a browser that keeps
 * running would hold Settings' pipe open past the helper's exit. So the
 * dialog commands keep a private, close-on-exec copy of stdout for the
 * result and point the standard streams at /dev/null (see private_output). */
static FILE *result_out;

typedef struct {
  GMainLoop *loop;
  GoaClient *client;
  GHashTable *before;
  GError *error;
  char *account_id;
  const char *provider_type;
  gboolean reconnect;
  gboolean closing;
  gboolean finished;
  int status;
} Task;

static void
json_string (GString *out, const char *value)
{
  g_string_append_c (out, '"');
  for (const unsigned char *p = (const unsigned char *) (value ? value : ""); *p; p++)
    {
      if (*p == '"' || *p == '\\')
        g_string_append_printf (out, "\\%c", *p);
      else if (*p == '\n')
        g_string_append (out, "\\n");
      else if (*p < 0x20)
        g_string_append_printf (out, "\\u%04x", *p);
      else
        g_string_append_c (out, (char) *p);
    }
  g_string_append_c (out, '"');
}

/* GOA's errors can quote the browser's answer, authorization code and all
 * (an unexpected or stale sign-in tab). Such text never leaves the helper. */
static gboolean
safe_to_show (const char *message)
{
  return message != NULL && *message != '\0'
    && strstr (message, ":/") == NULL && strstr (message, "code=") == NULL
    && strstr (message, "token") == NULL && strstr (message, "state=") == NULL;
}

static void
print_result (const char *result, const char *id, const char *reason, const char *message)
{
  g_autoptr (GString) out = g_string_new ("{\"result\":");
  json_string (out, result);
  if (message != NULL && *message != '\0' && !safe_to_show (message) && reason == NULL)
    reason = "response";
  if (reason != NULL)
    {
      g_string_append (out, ",\"reason\":");
      json_string (out, reason);
    }
  if (id != NULL)
    {
      g_string_append (out, ",\"id\":");
      json_string (out, id);
    }
  if (safe_to_show (message))
    {
      g_string_append (out, ",\"message\":");
      json_string (out, message);
    }
  g_string_append (out, "}\n");
  FILE *out_file = result_out ? result_out : stdout;
  fputs (out->str, out_file);
  fflush (out_file);
}

static int
fail (const char *reason, const char *message)
{
  print_result ("failed", NULL, reason, message);
  return EXIT_FAILED;
}

static void
private_output (void)
{
  int copy = fcntl (STDOUT_FILENO, F_DUPFD_CLOEXEC, 3);
  int null = open ("/dev/null", O_RDWR | O_CLOEXEC);
  if (copy < 0 || null < 0)
    return;
  result_out = fdopen (copy, "w");
  if (result_out == NULL)
    return;
  fflush (stdout);
  dup2 (null, STDOUT_FILENO);
  dup2 (null, STDERR_FILENO);
  close (null);
}

/* ---- list ------------------------------------------------------------- */

typedef struct {
  GMainLoop *loop;
  GList *providers;
  GError *error;
} ListTask;

static void
list_done (GObject *source, GAsyncResult *result, gpointer user_data)
{
  ListTask *task = user_data;
  (void) source;
  goa_provider_get_all_finish (&task->providers, result, &task->error);
  g_main_loop_quit (task->loop);
}

/* Needs no display and no session bus: GOA reads its providers, and the
 * ones goa.conf disables, from the library itself. */
static int
list_providers (void)
{
  ListTask task = { g_main_loop_new (NULL, FALSE), NULL, NULL };
  goa_provider_get_all (list_done, &task);
  g_main_loop_run (task.loop);
  g_main_loop_unref (task.loop);
  if (task.error != NULL)
    {
      int status = fail ("no-providers", task.error->message);
      g_error_free (task.error);
      return status;
    }

  g_autoptr (GString) out = g_string_new ("{\"providers\":[");
  gboolean first = TRUE;
  for (GList *l = task.providers; l != NULL; l = l->next)
    {
      GoaProvider *provider = GOA_PROVIDER (l->data);
      g_autofree char *name = goa_provider_get_provider_name (provider, NULL);
      if (!first)
        g_string_append_c (out, ',');
      first = FALSE;
      g_string_append (out, "{\"type\":");
      json_string (out, goa_provider_get_provider_type (provider));
      g_string_append (out, ",\"name\":");
      json_string (out, name);
      g_string_append_c (out, '}');
    }
  g_string_append (out, "]}\n");
  g_list_free_full (task.providers, g_object_unref);
  fputs (out->str, stdout);
  fflush (stdout);
  return EXIT_DONE;
}

/* ---- add and reconnect -------------------------------------------------- */

static GHashTable *
account_ids (GoaClient *client)
{
  GHashTable *ids = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);
  GList *objects = goa_client_get_accounts (client);
  for (GList *l = objects; l != NULL; l = l->next)
    {
      GoaAccount *account = goa_object_peek_account (GOA_OBJECT (l->data));
      if (account != NULL)
        g_hash_table_add (ids, g_strdup (goa_account_get_id (account)));
    }
  g_list_free_full (objects, g_object_unref);
  return ids;
}

/* An account of the requested kind that appeared while the dialog was open,
 * if any. Kerberos keeps a temporary account until its password is given;
 * that one is not an added account. */
static char *
new_account_id (Task *task)
{
  char *found = NULL;
  GList *objects = goa_client_get_accounts (task->client);
  for (GList *l = objects; l != NULL && found == NULL; l = l->next)
    {
      GoaAccount *account = goa_object_peek_account (GOA_OBJECT (l->data));
      if (account != NULL && !g_hash_table_contains (task->before, goa_account_get_id (account))
          && !goa_account_get_is_temporary (account)
          && g_strcmp0 (goa_account_get_provider_type (account), task->provider_type) == 0)
        found = g_strdup (goa_account_get_id (account));
    }
  g_list_free_full (objects, g_object_unref);
  return found;
}

static gboolean
is_cancel (const GError *error)
{
  return g_error_matches (error, GOA_ERROR, GOA_ERROR_DIALOG_DISMISSED)
    || g_error_matches (error, G_IO_ERROR, G_IO_ERROR_CANCELLED);
}

static void
finish (Task *task, const char *result, const char *id, const char *reason, const char *message, int status)
{
  if (task->finished)
    return;
  task->finished = TRUE;
  task->status = status;
  print_result (result, id, reason, message);
  g_main_loop_quit (task->loop);
}

/* An added account counts once goa-daemon can hand out its credentials:
 * goa-daemon does not report a keyring that would not store them. */
static void
finish_added (Task *task, const char *id, const char *warning)
{
  g_autoptr (GoaObject) object = id ? goa_client_lookup_by_id (task->client, id) : NULL;
  GoaAccount *account = object ? goa_object_peek_account (object) : NULL;
  g_autoptr (GError) error = NULL;
  if (warning == NULL && account != NULL
      && !goa_account_call_ensure_credentials_sync (account, NULL, NULL, &error))
    {
      finish (task, "added", id, "unverified", error ? error->message : NULL, EXIT_DONE);
      return;
    }
  finish (task, "added", id, warning ? "unverified" : NULL, warning, EXIT_DONE);
}

/* GOA tells its client about a new account over D-Bus; give that signal a
 * moment to arrive before deciding an unsuccessful add left nothing behind. */
static gboolean
settle_add (gpointer user_data)
{
  Task *task = user_data;
  g_autofree char *id = new_account_id (task);
  if (id != NULL)
    finish_added (task, id, task->error && !is_cancel (task->error) ? task->error->message : NULL);
  else if (task->error == NULL || is_cancel (task->error))
    finish (task, "cancelled", NULL, NULL, NULL, EXIT_CANCELLED);
  else
    finish (task, "failed", NULL, NULL, task->error->message, EXIT_FAILED);
  return G_SOURCE_REMOVE;
}

static void
add_done (GObject *source, GAsyncResult *result, gpointer user_data)
{
  Task *task = user_data;
  g_autoptr (GoaObject) object = goa_provider_add_account_finish (GOA_PROVIDER (source), result, &task->error);
  if (object != NULL)
    {
      /* GOA may hand back an account together with an error, for example
       * when storing its credentials in the keyring failed: it exists, so
       * report it as added and pass the warning on. */
      GoaAccount *account = goa_object_peek_account (object);
      finish_added (task, account ? goa_account_get_id (account) : NULL,
                    task->error ? task->error->message : NULL);
      return;
    }
  g_timeout_add (500, settle_add, task);
}

static void
reconnect_done (GObject *source, GAsyncResult *result, gpointer user_data)
{
  Task *task = user_data;
  if (goa_provider_refresh_account_finish (GOA_PROVIDER (source), result, &task->error))
    finish (task, "reconnected", task->account_id, NULL, NULL, EXIT_DONE);
  else if (task->error == NULL || is_cancel (task->error))
    finish (task, "cancelled", task->account_id, NULL, NULL, EXIT_CANCELLED);
  else
    finish (task, "failed", task->account_id, NULL, task->error->message, EXIT_FAILED);
}

/* Settings' Cancel: close GOA's dialog the way its own close button does,
 * and GOA answers that it was dismissed. Should it not answer, stop anyway
 * after a few seconds. */
static gboolean
give_up (gpointer user_data)
{
  Task *task = user_data;
  if (task->reconnect)
    finish (task, "cancelled", task->account_id, NULL, NULL, EXIT_CANCELLED);
  else
    settle_add (task);
  return G_SOURCE_REMOVE;
}

/* The handler stays installed: a second Cancel must not fall back to the
 * signal's default action and end the helper without a result. */
static gboolean
on_signal (gpointer user_data)
{
  Task *task = user_data;
  if (task->closing)
    return G_SOURCE_CONTINUE;
  task->closing = TRUE;
  /* Not g_cancellable_cancel(): with no parent window, GOA 3.58 disposes the
   * dialog inside its own cancellation handler, and the dispose disconnects
   * that handler, which waits for the handler to return: a deadlock. */
  GListModel *windows = gtk_window_get_toplevels ();
  for (guint i = g_list_model_get_n_items (windows); i > 0; i--)
    {
      g_autoptr (GtkWindow) window = g_list_model_get_item (windows, i - 1);
      gtk_window_close (window);
    }
  g_timeout_add_seconds (5, give_up, task);
  return G_SOURCE_CONTINUE;
}

static gboolean
reconnectable_type (const char *type)
{
  return type != NULL && g_strv_contains (reconnectable, type);
}

static int
run_dialog (const char *command, const char *argument)
{
  g_autoptr (GError) error = NULL;
  Task task = { 0 };

  private_output ();
  task.loop = g_main_loop_new (NULL, FALSE);
  task.reconnect = g_str_equal (command, "reconnect");
  g_unix_signal_add (SIGTERM, on_signal, &task);
  g_unix_signal_add (SIGINT, on_signal, &task);

  g_set_prgname (APP_ID);
  g_set_application_name ("Online Accounts");
  /* Without a display gtk_init() would end the program before any result. */
  if (!gtk_init_check ())
    return fail ("no-display", NULL);
  adw_init ();

  task.client = goa_client_new_sync (NULL, &error);
  if (task.client == NULL)
    return fail ("no-service", error ? error->message : NULL);
  if (goa_client_get_manager (task.client) == NULL)
    return fail ("no-service", NULL);

  if (task.reconnect)
    {
      g_autoptr (GoaObject) object = goa_client_lookup_by_id (task.client, argument);
      GoaAccount *account = object ? goa_object_peek_account (object) : NULL;
      if (account == NULL)
        return fail ("gone", NULL);
      if (goa_account_get_is_locked (account))
        return fail ("managed", NULL);
      const char *type = goa_account_get_provider_type (account);
      GoaProvider *provider = reconnectable_type (type) ? goa_provider_get_for_provider_type (type) : NULL;
      if (provider == NULL)
        return fail ("unsupported", NULL);
      task.account_id = g_strdup (argument);
      goa_provider_refresh_account (provider, task.client, object, NULL, NULL, reconnect_done, &task);
      g_object_unref (provider);
    }
  else
    {
      GoaProvider *provider = goa_provider_get_for_provider_type (argument);
      if (provider == NULL)
        return fail ("unknown-provider", NULL);
      task.provider_type = argument;
      task.before = account_ids (task.client);
      goa_provider_add_account (provider, task.client, NULL, NULL, add_done, &task);
      g_object_unref (provider);
    }

  g_main_loop_run (task.loop);

  g_clear_error (&task.error);
  g_clear_pointer (&task.before, g_hash_table_unref);
  g_free (task.account_id);
  g_object_unref (task.client);
  g_main_loop_unref (task.loop);
  return task.status;
}

int
main (int argc, char **argv)
{
  setlocale (LC_ALL, "");
  if (argc == 2 && g_str_equal (argv[1], "list"))
    return list_providers ();
  if (argc == 3 && (g_str_equal (argv[1], "add") || g_str_equal (argv[1], "reconnect")) && *argv[2] != '\0')
    return run_dialog (argv[1], argv[2]);
  fputs ("usage: cybexos-goa-account list | add PROVIDER-TYPE | reconnect ACCOUNT-ID\n", stderr);
  return EXIT_USAGE;
}
